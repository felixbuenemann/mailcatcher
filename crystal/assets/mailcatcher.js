// MailCatcher JavaScript - converted from CoffeeScript
// Vendor libraries are bundled inline at the bottom

// Add a new jQuery selector expression which does a case-insensitive :contains
jQuery.expr.pseudos.icontains = function(a, i, m) {
  return (a.textContent || a.innerText || "").toUpperCase().indexOf(m[3].toUpperCase()) >= 0;
};

class MailCatcher {
  constructor() {
    this.getTab = this.getTab.bind(this);
    this.selectedTab = this.selectedTab.bind(this);
    this.openTab = this.openTab.bind(this);
    this.previousTab = this.previousTab.bind(this);
    this.nextTab = this.nextTab.bind(this);

    $("#messages").on("click", "tr", (e) => {
      e.preventDefault();
      this.loadMessage($(e.currentTarget).attr("data-message-id"));
    });

    $("input[name=search]").on("keyup", (e) => {
      const query = $.trim($(e.currentTarget).val());
      if (query) {
        this.searchMessages(query);
      } else {
        this.clearSearch();
      }
    });

    $("#message").on("click", ".views .format.tab a", (e) => {
      e.preventDefault();
      this.loadMessageBody(this.selectedMessage(), $($(e.currentTarget).parent("li")).data("message-format"));
    });

    $("#message iframe").on("load", () => {
      this.decorateMessageBody();
    });

    $("#resizer").on("mousedown", (e) => {
      e.preventDefault();
      const events = {
        mouseup: (e) => {
          e.preventDefault();
          $(window).off(events);
        },
        mousemove: (e) => {
          e.preventDefault();
          this.resizeTo(e.clientY);
        }
      };
      $(window).on(events);
    });

    this.resizeToSaved();

    $("nav.app .clear a").on("click", (e) => {
      e.preventDefault();
      if (confirm("You will lose all your received messages.\n\nAre you sure you want to clear all messages?")) {
        $.ajax({
          url: new URL("messages", document.baseURI).toString(),
          type: "DELETE",
          success: () => {
            this.clearMessages();
          },
          error: () => {
            alert("Error while clearing all messages.");
          }
        });
      }
    });

    $("nav.app .quit a").on("click", (e) => {
      e.preventDefault();
      if (confirm("You will lose all your received messages.\n\nAre you sure you want to quit?")) {
        this.quitting = true;
        $.ajax({
          type: "DELETE",
          success: () => {
            this.hasQuit();
          },
          error: () => {
            this.quitting = false;
            alert("Error while quitting.");
          }
        });
      }
    });

    this.favcount = new Favcount($('link[rel="icon"]').attr("href"));

    key("up", () => {
      if (this.selectedMessage()) {
        this.loadMessage($("#messages tr.selected").prevAll(":visible").first().data("message-id"));
      } else {
        this.loadMessage($("#messages tbody tr[data-message-id]").first().data("message-id"));
      }
      return false;
    });

    key("down", () => {
      if (this.selectedMessage()) {
        this.loadMessage($("#messages tr.selected").nextAll(":visible").data("message-id"));
      } else {
        this.loadMessage($("#messages tbody tr[data-message-id]:first").data("message-id"));
      }
      return false;
    });

    key("⌘+up, ctrl+up", () => {
      this.loadMessage($("#messages tbody tr[data-message-id]:visible").first().data("message-id"));
      return false;
    });

    key("⌘+down, ctrl+down", () => {
      this.loadMessage($("#messages tbody tr[data-message-id]:visible").first().data("message-id"));
      return false;
    });

    key("left", () => {
      this.openTab(this.previousTab());
      return false;
    });

    key("right", () => {
      this.openTab(this.nextTab());
      return false;
    });

    key("backspace, delete", () => {
      const id = this.selectedMessage();
      if (id != null) {
        $.ajax({
          url: new URL(`messages/${id}`, document.baseURI).toString(),
          type: "DELETE",
          success: () => {
            this.removeMessage(id);
          },
          error: () => {
            alert("Error while removing message.");
          }
        });
      }
      return false;
    });

    this.refresh();
    this.subscribe();
  }

  // Date parsing - Safari's Date parsing is problematic
  parseDateRegexp = /^(\d{4})[-\/\\](\d{2})[-\/\\](\d{2})(?:\s+|T)(\d{2})[:-](\d{2})[:-](\d{2})(?:([ +-]\d{2}:\d{2}|\s*\S+|Z?))?$/;

  parseDate(date) {
    const match = this.parseDateRegexp.exec(date);
    if (match) {
      return new Date(match[1], match[2] - 1, match[3], match[4], match[5], match[6], 0);
    }
    return null;
  }

  offsetTimeZone(date) {
    const offset = new Date().getTimezoneOffset() * 60000;
    date.setTime(date.getTime() - offset);
    return date;
  }

  formatDate(date) {
    if (typeof date === "string") {
      date = this.parseDate(date);
    }
    if (date) {
      date = this.offsetTimeZone(date);
      // Format: "Wednesday, 4 Dec 2024 3:45:30 PM"
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const dayName = days[date.getDay()];
      const monthName = months[date.getMonth()];
      const day = date.getDate();
      const year = date.getFullYear();
      let hours = date.getHours();
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const seconds = date.getSeconds().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      return `${dayName}, ${day} ${monthName} ${year} ${hours}:${minutes}:${seconds} ${ampm}`;
    }
    return "";
  }

  messagesCount() {
    return $("#messages tr").length - 1;
  }

  updateMessagesCount() {
    this.favcount.set(this.messagesCount());
    document.title = 'MailCatcher (' + this.messagesCount() + ')';
  }

  tabs() {
    return $("#message ul").children(".tab");
  }

  getTab(i) {
    return $(this.tabs()[i]);
  }

  selectedTab() {
    return this.tabs().index($("#message li.tab.selected"));
  }

  openTab(i) {
    this.getTab(i).children("a").click();
  }

  previousTab(tab) {
    let i = (tab != null || tab === 0) ? tab : this.selectedTab() - 1;
    if (i < 0) {
      i = this.tabs().length - 1;
    }
    if (this.getTab(i).is(":visible")) {
      return i;
    } else {
      return this.previousTab(i - 1);
    }
  }

  nextTab(tab) {
    let i = tab ? tab : this.selectedTab() + 1;
    if (i > this.tabs().length - 1) {
      i = 0;
    }
    if (this.getTab(i).is(":visible")) {
      return i;
    } else {
      return this.nextTab(i + 1);
    }
  }

  haveMessage(message) {
    const id = message.id != null ? message.id : message;
    return $(`#messages tbody tr[data-message-id="${id}"]`).length > 0;
  }

  selectedMessage() {
    return $("#messages tr.selected").data("message-id");
  }

  searchMessages(query) {
    const tokens = query.split(/\s+/);
    const selector = tokens.map(token => `:icontains('${token}')`).join("");
    const $rows = $("#messages tbody tr");
    $rows.not(selector).hide();
    $rows.filter(selector).show();
  }

  clearSearch() {
    $("#messages tbody tr").show();
  }

  addMessage(message) {
    $("<tr />").attr("data-message-id", message.id.toString())
      .append($("<td/>").text(message.sender || "No sender").toggleClass("blank", !message.sender))
      .append($("<td/>").text((message.recipients || []).join(", ") || "No recipients").toggleClass("blank", !message.recipients || !message.recipients.length))
      .append($("<td/>").text(message.subject || "No subject").toggleClass("blank", !message.subject))
      .append($("<td/>").text(this.formatDate(message.created_at)))
      .prependTo($("#messages tbody"));
    this.updateMessagesCount();
  }

  removeMessage(id) {
    const messageRow = $(`#messages tbody tr[data-message-id="${id}"]`);
    const isSelected = messageRow.is(".selected");
    let switchTo;
    if (isSelected) {
      switchTo = messageRow.next().data("message-id") || messageRow.prev().data("message-id");
    }
    messageRow.remove();
    if (isSelected) {
      if (switchTo) {
        this.loadMessage(switchTo);
      } else {
        this.unselectMessage();
      }
    }
    this.updateMessagesCount();
  }

  clearMessages() {
    $("#messages tbody tr").remove();
    this.unselectMessage();
    this.updateMessagesCount();
  }

  scrollToRow(row) {
    const relativePosition = row.offset().top - $("#messages").offset().top;
    if (relativePosition < 0) {
      $("#messages").scrollTop($("#messages").scrollTop() + relativePosition - 20);
    } else {
      const overflow = relativePosition + row.height() - $("#messages").height();
      if (overflow > 0) {
        $("#messages").scrollTop($("#messages").scrollTop() + overflow + 20);
      }
    }
  }

  unselectMessage() {
    $("#messages tbody, #message .metadata dd").empty();
    $("#message .metadata .attachments").hide();
    $("#message iframe").attr("src", "about:blank");
    return null;
  }

  loadMessage(id) {
    if (id != null && id.id != null) {
      id = id.id;
    }
    if (id == null) {
      id = $("#messages tr.selected").attr("data-message-id");
    }

    if (id != null) {
      $(`#messages tbody tr:not([data-message-id='${id}'])`).removeClass("selected");
      const messageRow = $(`#messages tbody tr[data-message-id='${id}']`);
      messageRow.addClass("selected");
      this.scrollToRow(messageRow);

      $.getJSON(`messages/${id}.json`, (message) => {
        $("#message .metadata dd.created_at").text(this.formatDate(message.created_at));
        $("#message .metadata dd.from").text(message.sender);
        $("#message .metadata dd.to").text((message.recipients || []).join(", "));
        $("#message .metadata dd.subject").text(message.subject);
        $("#message .views .tab.format").each((i, el) => {
          const $el = $(el);
          const format = $el.attr("data-message-format");
          if ($.inArray(format, message.formats) >= 0) {
            $el.find("a").attr("href", `messages/${id}.${format}`);
            $el.show();
          } else {
            $el.hide();
          }
        });

        if ($("#message .views .tab.selected:not(:visible)").length) {
          $("#message .views .tab.selected").removeClass("selected");
          $("#message .views .tab:visible:first").addClass("selected");
        }

        if (message.attachments && message.attachments.length) {
          const $ul = $("<ul/>").appendTo($("#message .metadata dd.attachments").empty());
          $.each(message.attachments, (i, attachment) => {
            $ul.append($("<li>").append($("<a>").attr("href", `messages/${id}/parts/${attachment["cid"]}`).addClass(attachment["type"].split("/", 1)[0]).addClass(attachment["type"].replace("/", "-")).text(attachment["filename"])));
          });
          $("#message .metadata .attachments").show();
        } else {
          $("#message .metadata .attachments").hide();
        }

        $("#message .views .download a").attr("href", `messages/${id}.eml`);
        this.loadMessageBody();
      });
    }
  }

  loadMessageBody(id, format) {
    if (id == null) {
      id = this.selectedMessage();
    }
    if (format == null) {
      format = $("#message .views .tab.format.selected").attr("data-message-format");
    }
    if (format == null) {
      format = "html";
    }

    $(`#message .views .tab[data-message-format="${format}"]:not(.selected)`).addClass("selected");
    $(`#message .views .tab:not([data-message-format="${format}"]).selected`).removeClass("selected");

    if (id != null) {
      $("#message iframe").attr("src", `messages/${id}.${format}`);
    }
  }

  decorateMessageBody() {
    const format = $("#message .views .tab.format.selected").attr("data-message-format");

    switch (format) {
      case "html":
        const body = $("#message iframe").contents().find("body");
        $("a", body).attr("target", "_blank");
        break;
      case "plain":
        const message_iframe = $("#message iframe").contents();
        let text = message_iframe.text();

        // Escape special characters
        text = text.replace(/&/g, "&amp;");
        text = text.replace(/</g, "&lt;");
        text = text.replace(/>/g, "&gt;");
        text = text.replace(/"/g, "&quot;");

        // Autolink text
        text = text.replace(/((http|ftp|https):\/\/[\w\-_]+(\.[\w\-_]+)+([\w\-\.,@?^=%&amp;:\/~\+#]*[\w\-\@?^=%&amp;\/~\+#])?)/g, '<a href="$1" target="_blank">$1</a>');

        message_iframe.find("html").html(`<body style="font-family: sans-serif; white-space: pre-wrap">${text}</body>`);
        break;
    }
  }

  refresh() {
    $.getJSON("messages", (messages) => {
      $.each(messages, (i, message) => {
        if (!this.haveMessage(message)) {
          this.addMessage(message);
        }
      });
      this.updateMessagesCount();
    });
  }

  subscribe() {
    if (typeof WebSocket !== "undefined") {
      this.subscribeWebSocket();
    } else {
      this.subscribePoll();
    }
  }

  subscribeWebSocket() {
    const secure = window.location.protocol === "https:";
    const url = new URL("messages", document.baseURI);
    url.protocol = secure ? "wss" : "ws";
    this.websocket = new WebSocket(url.toString());
    this.websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "add") {
        this.addMessage(data.message);
      } else if (data.type === "remove") {
        this.removeMessage(data.id);
      } else if (data.type === "clear") {
        this.clearMessages();
      } else if (data.type === "quit" && !this.quitting) {
        alert("MailCatcher has been quit");
        this.hasQuit();
      }
    };
  }

  subscribePoll() {
    if (this.refreshInterval == null) {
      this.refreshInterval = setInterval(() => this.refresh(), 1000);
    }
  }

  resizeToSavedKey = "mailcatcherSeparatorHeight";

  resizeTo(height) {
    $("#messages").css({
      height: height - $("#messages").offset().top
    });
    if (window.localStorage) {
      window.localStorage.setItem(this.resizeToSavedKey, height);
    }
  }

  resizeToSaved() {
    const height = parseInt(window.localStorage ? window.localStorage.getItem(this.resizeToSavedKey) : null);
    if (!isNaN(height)) {
      this.resizeTo(height);
    }
  }

  hasQuit() {
    location.assign($("body > header h1 a").attr("href"));
  }
}

$(function() {
  window.MailCatcher = new MailCatcher();
});

// ============================================
// Vendor Libraries (bundled inline)
// ============================================

// Favcount - favicon badge counter
(function() {
  var Favcount = function(icon) {
    this.icon = icon;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 16;
    this.canvas.height = 16;
    this.ctx = this.canvas.getContext('2d');
    this.img = new Image();
    this.img.src = icon;
  };

  Favcount.prototype.set = function(count) {
    var self = this;
    this.img.onload = function() {
      self.ctx.clearRect(0, 0, 16, 16);
      self.ctx.drawImage(self.img, 0, 0, 16, 16);
      if (count > 0) {
        self.ctx.fillStyle = '#e74c3c';
        self.ctx.beginPath();
        self.ctx.arc(12, 4, 4, 0, 2 * Math.PI);
        self.ctx.fill();
        self.ctx.fillStyle = '#fff';
        self.ctx.font = 'bold 8px Arial';
        self.ctx.textAlign = 'center';
        self.ctx.textBaseline = 'middle';
        if (count > 9) {
          self.ctx.fillText('+', 12, 4);
        } else {
          self.ctx.fillText(count.toString(), 12, 4);
        }
      }
      var link = document.querySelector('link[rel="icon"]');
      if (link) {
        link.href = self.canvas.toDataURL('image/png');
      }
    };
    if (this.img.complete) {
      this.img.onload();
    }
  };

  window.Favcount = Favcount;
})();

// Keymaster - keyboard shortcuts
(function(global) {
  var k,
    _handlers = {},
    _mods = { 16: false, 17: false, 18: false, 91: false },
    _scope = 'all',
    _MODIFIERS = {
      '⇧': 16, shift: 16,
      '⌥': 18, alt: 18, option: 18,
      '⌃': 17, ctrl: 17, control: 17,
      '⌘': 91, command: 91
    },
    _MAP = {
      backspace: 8, tab: 9, clear: 12,
      enter: 13, 'return': 13,
      esc: 27, escape: 27, space: 32,
      left: 37, up: 38, right: 39, down: 40,
      del: 46, 'delete': 46,
      home: 36, end: 35,
      pageup: 33, pagedown: 34,
      ',': 188, '.': 190, '/': 191,
      '`': 192, '-': 189, '=': 187,
      ';': 186, '\'': 222,
      '[': 219, ']': 221, '\\': 220
    },
    code = function(x) {
      return _MAP[x] || x.toUpperCase().charCodeAt(0);
    },
    _downKeys = [];

  for (k = 1; k < 20; k++) _MAP['f' + k] = 111 + k;

  function index(array, item) {
    var i = array.length;
    while (i--) if (array[i] === item) return i;
    return -1;
  }

  function compareArray(a1, a2) {
    if (a1.length !== a2.length) return false;
    for (var i = 0; i < a1.length; i++) {
      if (a1[i] !== a2[i]) return false;
    }
    return true;
  }

  var modifierMap = {
    16: 'shiftKey',
    17: 'ctrlKey',
    18: 'altKey',
    91: 'metaKey'
  };

  function updateModifierKey(event) {
    for (var k in _mods) _mods[k] = event[modifierMap[k]];
  }

  function dispatch(event) {
    var key, handler, k, i, modifiersMatch, scope;
    key = event.keyCode;

    if (index(_downKeys, key) === -1) {
      _downKeys.push(key);
    }

    if (key === 93 || key === 224) key = 91;
    if (key in _mods) {
      _mods[key] = true;
      for (k in _MODIFIERS) if (_MODIFIERS[k] === key) assignKey[k] = true;
      return;
    }
    updateModifierKey(event);

    if (!_handlers[key]) return;

    scope = getScope();

    for (i = 0; i < _handlers[key].length; i++) {
      handler = _handlers[key][i];

      if (handler.scope === scope || handler.scope === 'all') {
        modifiersMatch = handler.mods.length > 0;
        for (k in _mods) {
          if ((!_mods[k] && index(handler.mods, +k) > -1) ||
            (_mods[k] && index(handler.mods, +k) === -1)) modifiersMatch = false;
        }

        if ((handler.mods.length === 0 && !_mods[16] && !_mods[17] && !_mods[18] && !_mods[91]) || modifiersMatch) {
          if (handler.method(event, handler) === false) {
            if (event.preventDefault) event.preventDefault();
            else event.returnValue = false;
            if (event.stopPropagation) event.stopPropagation();
            if (event.cancelBubble) event.cancelBubble = true;
          }
        }
      }
    }
  }

  function clearModifier(event) {
    var key = event.keyCode, k,
      i = index(_downKeys, key);

    if (i >= 0) {
      _downKeys.splice(i, 1);
    }

    if (key === 93 || key === 224) key = 91;
    if (key in _mods) {
      _mods[key] = false;
      for (k in _MODIFIERS) if (_MODIFIERS[k] === key) assignKey[k] = false;
    }
  }

  function resetModifiers() {
    for (var k in _mods) _mods[k] = false;
    for (var k in _MODIFIERS) assignKey[k] = false;
  }

  function assignKey(key, scope, method) {
    var keys, mods;
    keys = getKeys(key);
    if (method === undefined) {
      method = scope;
      scope = 'all';
    }

    for (var i = 0; i < keys.length; i++) {
      mods = [];
      key = keys[i].split('+');
      if (key.length > 1) {
        mods = getMods(key);
        key = [key[key.length - 1]];
      }
      key = key[0];
      key = code(key);

      if (!(key in _handlers)) _handlers[key] = [];
      _handlers[key].push({ shortcut: keys[i], scope: scope, method: method, key: keys[i], mods: mods });
    }
  }

  function getKeys(key) {
    var keys;
    key = key.replace(/\s/g, '');
    keys = key.split(',');
    if ((keys[keys.length - 1]) === '') {
      keys[keys.length - 2] += ',';
    }
    return keys;
  }

  function getMods(key) {
    var mods = key.slice(0, key.length - 1);
    for (var mi = 0; mi < mods.length; mi++)
      mods[mi] = _MODIFIERS[mods[mi]];
    return mods;
  }

  function getScope() {
    return _scope || 'all';
  }

  function setScope(scope) {
    _scope = scope || 'all';
  }

  function deleteScope(scope) {
    var key, handlers, i;
    for (key in _handlers) {
      handlers = _handlers[key];
      for (i = 0; i < handlers.length;) {
        if (handlers[i].scope === scope) handlers.splice(i, 1);
        else i++;
      }
    }
  }

  function unbindKey(key, scope) {
    var keys = key.split(','),
      i, j, obj;

    for (i = 0; i < keys.length; i++) {
      var keyCode = code(keys[i]);
      if (_handlers[keyCode]) {
        for (j = 0; j < _handlers[keyCode].length;) {
          obj = _handlers[keyCode][j];
          if (scope === undefined || obj.scope === scope) {
            _handlers[keyCode].splice(j, 1);
          } else {
            j++;
          }
        }
      }
    }
  }

  function isPressed(keyCode) {
    if (typeof keyCode === 'string') {
      keyCode = code(keyCode);
    }
    return index(_downKeys, keyCode) !== -1;
  }

  function getPressedKeyCodes() {
    return _downKeys.slice(0);
  }

  function filter(event) {
    var tagName = (event.target || event.srcElement).tagName;
    return !(tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA');
  }

  if (global.document) {
    global.document.onkeydown = function(event) {
      if (filter(event)) dispatch(event);
    };
    global.document.onkeyup = clearModifier;
  }

  global.key = assignKey;
  global.key.setScope = setScope;
  global.key.getScope = getScope;
  global.key.deleteScope = deleteScope;
  global.key.filter = filter;
  global.key.isPressed = isPressed;
  global.key.getPressedKeyCodes = getPressedKeyCodes;
  global.key.unbind = unbindKey;

})(window);
