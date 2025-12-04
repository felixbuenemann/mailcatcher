require "kemal"
require "json"
require "../bus"
require "../mail"
require "./assets"

module MailCatcher
  module Web
    @@config : Config? = nil
    @@quit_proc : Proc(Nil)? = nil

    # Custom handler to intercept routes with file extensions
    # Kemal's radix router doesn't handle dots in parameters well
    class MessageFormatHandler
      include HTTP::Handler

      def initialize(@prefix : String)
      end

      def call(context : HTTP::Server::Context)
        path = context.request.path

        # Strip prefix
        if !@prefix.empty? && path.starts_with?(@prefix)
          path = path[@prefix.size..]
          path = "/" if path.empty?
        end

        # Handle message routes with extensions (GET only)
        if context.request.method == "GET"
          if match = path.match(/^\/messages\/(\d+)\.(json|html|plain|source|eml)$/)
            id = match[1].to_i64
            format = match[2]
            serve_message_by_format(context, id, format)
            return
          end
        end

        # Pass to next handler
        call_next(context)
      end

      private def serve_message_by_format(env : HTTP::Server::Context, id : Int64, format : String)
        case format
        when "json"
          if message = Mail.message(id)
            env.response.content_type = "application/json"

            formats = ["source"]
            formats << "html" if Mail.message_has_html?(id)
            formats << "plain" if Mail.message_has_plain?(id)

            result = message.dup
            result["formats"] = JSON::Any.new(formats.map { |f| JSON::Any.new(f) })
            result["attachments"] = JSON::Any.new(Mail.message_attachments(id).map { |a| JSON::Any.new(a.transform_values { |v| v }) })

            env.response.print result.to_json
          else
            env.response.status_code = 404
            env.response.content_type = "text/plain"
            env.response.print "Not found"
          end

        when "html"
          if part = Mail.message_part_html(id)
            charset = part.charset || "utf-8"
            env.response.content_type = "text/html; charset=#{charset}"

            body = String.new(part.body)
            body = body.gsub(/cid:([^'">\s]+)/) { "#{id}/parts/#{$1}" }
            env.response.print body
          else
            env.response.status_code = 404
            env.response.content_type = "text/plain"
            env.response.print "Not found"
          end

        when "plain"
          if part = Mail.message_part_plain(id)
            charset = part.charset || "utf-8"
            env.response.content_type = "#{part.type || "text/plain"}; charset=#{charset}"
            env.response.print String.new(part.body)
          else
            env.response.status_code = 404
            env.response.content_type = "text/plain"
            env.response.print "Not found"
          end

        when "source"
          if source = Mail.message_source(id)
            env.response.content_type = "text/plain"
            env.response.print source
          else
            env.response.status_code = 404
            env.response.content_type = "text/plain"
            env.response.print "Not found"
          end

        when "eml"
          if source = Mail.message_source(id)
            env.response.content_type = "message/rfc822"
            env.response.headers["Content-Disposition"] = "attachment; filename=\"message-#{id}.eml\""
            env.response.print source
          else
            env.response.status_code = 404
            env.response.content_type = "text/plain"
            env.response.print "Not found"
          end

        else
          env.response.status_code = 404
          env.response.content_type = "text/plain"
          env.response.print "Not found"
        end
      end
    end

    def self.setup(config : Config, quit_proc : Proc(Nil))
      @@config = config
      @@quit_proc = quit_proc

      # Configure Kemal
      Kemal.config.env = "production"
      Kemal.config.logging = config.verbose
      Kemal.config.host_binding = config.http_ip
      Kemal.config.port = config.http_port

      # Add custom handler for message format routes
      prefix = config.http_path.chomp("/")
      prefix = "" if prefix == "/"
      add_handler MessageFormatHandler.new(prefix)

      setup_routes
    end

    def self.start
      Kemal.run
    end

    def self.stop
      Kemal.stop
    end

    private def self.config : Config
      @@config.not_nil!
    end

    private def self.setup_routes
      prefix = config.http_path.chomp("/")
      prefix = "" if prefix == "/"

      # Index page
      get "#{prefix}/" do |env|
        render_index(env)
      end

      # Quit endpoint
      delete "#{prefix}/" do |env|
        if config.quittable?
          @@quit_proc.try(&.call)
          env.response.status_code = 204
          ""
        else
          env.response.status_code = 403
          "Quit is disabled"
        end
      end

      # Messages list / WebSocket
      get "#{prefix}/messages" do |env|
        if env.request.headers["Upgrade"]? == "websocket"
          handle_websocket(env)
        else
          env.response.content_type = "application/json"
          Mail.messages.to_json
        end
      end

      # WebSocket endpoint (Kemal style)
      ws "#{prefix}/messages" do |socket|
        handle_websocket_connection(socket)
      end

      # Clear all messages
      delete "#{prefix}/messages" do |env|
        Mail.delete!
        env.response.status_code = 204
        ""
      end

      # Delete single message
      delete "#{prefix}/messages/:id" do |env|
        id = env.params.url["id"].to_i64
        if Mail.message(id)
          Mail.delete_message!(id)
          env.response.status_code = 204
          ""
        else
          env.response.status_code = 404
          "Not found"
        end
      end

      # Get part by CID: /messages/:id/parts/:cid
      get "#{prefix}/messages/:id/parts/:cid" do |env|
        id = env.params.url["id"].to_i64
        cid = env.params.url["cid"]
        if part = Mail.message_part_cid(id, cid)
          charset = part.charset
          content_type = part.type || "application/octet-stream"
          if charset && content_type.starts_with?("text/")
            env.response.content_type = "#{content_type}; charset=#{charset}"
          else
            env.response.content_type = content_type
          end
          if part.is_attachment == 1 && part.filename
            env.response.headers["Content-Disposition"] = "attachment; filename=\"#{part.filename}\""
          end
          env.response.write part.body
          ""
        else
          env.response.status_code = 404
          "Not found"
        end
      end

      # Serve assets
      get "#{prefix}/assets/mailcatcher.js" do |env|
        env.response.content_type = "application/javascript"
        Assets::JAVASCRIPT
      end

      get "#{prefix}/assets/mailcatcher.css" do |env|
        env.response.content_type = "text/css"
        Assets::STYLESHEET
      end

      get "#{prefix}/favicon.ico" do |env|
        env.response.content_type = "image/x-icon"
        env.response.write Assets::FAVICON
        ""
      end

      get "#{prefix}/assets/logo.png" do |env|
        env.response.content_type = "image/png"
        env.response.write Assets::LOGO
        ""
      end

      get "#{prefix}/assets/logo_2x.png" do |env|
        env.response.content_type = "image/png"
        env.response.write Assets::LOGO_2X
        ""
      end

      # Fallback redirect for non-root http_path
      if prefix != ""
        get "/" do |env|
          env.redirect "#{prefix}/"
        end
      end

      # 404 handler
      error 404 do |env|
        render_404(env)
      end
    end

    private def self.handle_websocket_connection(socket : HTTP::WebSocket)
      subscription = Bus.subscribe

      # Spawn a fiber to forward bus messages to the WebSocket
      spawn do
        loop do
          begin
            message = subscription.receive?
            break if message.nil?
            json = Bus.to_json(message)
            socket.send(json)
          rescue ex
            break
          end
        end
      end

      # When socket closes, unsubscribe
      socket.on_close do
        Bus.unsubscribe(subscription)
      end
    end

    private def self.handle_websocket(env : HTTP::Server::Context)
      env.response.status_code = 400
      "Use WebSocket endpoint"
    end

    private def self.render_index(env : HTTP::Server::Context) : String
      prefix = config.http_path.chomp("/")
      quittable = config.quittable?
      ECR.render("src/mailcatcher/web/templates/index.ecr")
    end

    private def self.render_404(env : HTTP::Server::Context) : String
      ECR.render("src/mailcatcher/web/templates/404.ecr")
    end
  end
end
