/**
 * Browser stealth patches — makes headless Chrome undetectable.
 *
 * Derived from puppeteer-extra-plugin-stealth evasions.
 * Applied via page.evaluateOnNewDocument() before navigation.
 *
 * Patches: chrome.app, chrome.csi, chrome.loadTimes, chrome.runtime,
 * navigator.webdriver, navigator.plugins, navigator.languages,
 * navigator.vendor, navigator.permissions, navigator.hardwareConcurrency,
 * window.outerdimensions, webgl.vendor, iframe.contentWindow
 */
export function getStealthScript(): string {
  return STEALTH_SCRIPT;
}

// Stealth script is inlined below — generated from puppeteer-extra-plugin-stealth
const STEALTH_SCRIPT = `
(function() {
  // ============================================================
  // Utility functions (from _utils/index.js)
  // ============================================================
  const utils = {};

  utils.init = () => {
    utils.preloadCache();
  };

  utils.stripProxyFromErrors = (handler = {}) => {
    const newHandler = {
      setPrototypeOf: function(target, proto) {
        if (proto === null)
          throw new TypeError('Cannot convert object to primitive value');
        if (Object.getPrototypeOf(target) === Object.getPrototypeOf(proto)) {
          throw new TypeError('Cyclic __proto__ value');
        }
        return Reflect.setPrototypeOf(target, proto);
      }
    };
    const traps = Object.getOwnPropertyNames(handler);
    traps.forEach(trap => {
      newHandler[trap] = function() {
        try {
          return handler[trap].apply(this, arguments || []);
        } catch (err) {
          if (!err || !err.stack || !err.stack.includes('at ')) {
            throw err;
          }
          const stripWithBlacklist = (stack, stripFirstLine = true) => {
            const blacklist = [
              'at Reflect.' + trap + ' ',
              'at Object.' + trap + ' ',
              'at Object.newHandler.<computed> [as ' + trap + '] '
            ];
            return (
              err.stack
                .split('\\n')
                .filter((line, index) => !(index === 1 && stripFirstLine))
                .filter(line => !blacklist.some(bl => line.trim().startsWith(bl)))
                .join('\\n')
            );
          };
          const stripWithAnchor = (stack, anchor) => {
            const stackArr = stack.split('\\n');
            anchor = anchor || 'at Object.newHandler.<computed> [as ' + trap + '] ';
            const anchorIndex = stackArr.findIndex(line =>
              line.trim().startsWith(anchor)
            );
            if (anchorIndex === -1) {
              return false;
            }
            stackArr.splice(1, anchorIndex);
            return stackArr.join('\\n');
          };
          err.stack = err.stack.replace(
            'at Object.toString (',
            'at Function.toString ('
          );
          if ((err.stack || '').includes('at Function.toString (')) {
            err.stack = stripWithBlacklist(err.stack, false);
            throw err;
          }
          err.stack = stripWithAnchor(err.stack) || stripWithBlacklist(err.stack);
          throw err;
        }
      };
    });
    return newHandler;
  };

  utils.stripErrorWithAnchor = (err, anchor) => {
    const stackArr = err.stack.split('\\n');
    const anchorIndex = stackArr.findIndex(line => line.trim().startsWith(anchor));
    if (anchorIndex === -1) {
      return err;
    }
    stackArr.splice(1, anchorIndex);
    err.stack = stackArr.join('\\n');
    return err;
  };

  utils.replaceProperty = (obj, propName, descriptorOverrides = {}) => {
    return Object.defineProperty(obj, propName, {
      ...(Object.getOwnPropertyDescriptor(obj, propName) || {}),
      ...descriptorOverrides
    });
  };

  utils.preloadCache = () => {
    if (utils.cache) {
      return;
    }
    utils.cache = {
      Reflect: {
        get: Reflect.get.bind(Reflect),
        apply: Reflect.apply.bind(Reflect)
      },
      nativeToStringStr: Function.toString + ''
    };
  };

  utils.makeNativeString = (name = '') => {
    return utils.cache.nativeToStringStr.replace('toString', name || '');
  };

  utils.patchToString = (obj, str = '') => {
    const handler = {
      apply: function(target, ctx) {
        if (ctx === Function.prototype.toString) {
          return utils.makeNativeString('toString');
        }
        if (ctx === obj) {
          return str || utils.makeNativeString(obj.name);
        }
        const hasSameProto = Object.getPrototypeOf(
          Function.prototype.toString
        ).isPrototypeOf(ctx.toString);
        if (!hasSameProto) {
          return ctx.toString();
        }
        return target.call(ctx);
      }
    };
    const toStringProxy = new Proxy(
      Function.prototype.toString,
      utils.stripProxyFromErrors(handler)
    );
    utils.replaceProperty(Function.prototype, 'toString', {
      value: toStringProxy
    });
  };

  utils.patchToStringNested = (obj = {}) => {
    return utils.execRecursively(obj, ['function'], utils.patchToString);
  };

  utils.redirectToString = (proxyObj, originalObj) => {
    const handler = {
      apply: function(target, ctx) {
        if (ctx === Function.prototype.toString) {
          return utils.makeNativeString('toString');
        }
        if (ctx === proxyObj) {
          const fallback = () =>
            originalObj && originalObj.name
              ? utils.makeNativeString(originalObj.name)
              : utils.makeNativeString(proxyObj.name);
          return originalObj + '' || fallback();
        }
        if (typeof ctx === 'undefined' || ctx === null) {
          return target.call(ctx);
        }
        const hasSameProto = Object.getPrototypeOf(
          Function.prototype.toString
        ).isPrototypeOf(ctx.toString);
        if (!hasSameProto) {
          return ctx.toString();
        }
        return target.call(ctx);
      }
    };
    const toStringProxy = new Proxy(
      Function.prototype.toString,
      utils.stripProxyFromErrors(handler)
    );
    utils.replaceProperty(Function.prototype, 'toString', {
      value: toStringProxy
    });
  };

  utils.replaceWithProxy = (obj, propName, handler) => {
    const originalObj = obj[propName];
    const proxyObj = new Proxy(obj[propName], utils.stripProxyFromErrors(handler));
    utils.replaceProperty(obj, propName, { value: proxyObj });
    utils.redirectToString(proxyObj, originalObj);
    return true;
  };

  utils.replaceGetterWithProxy = (obj, propName, handler) => {
    const fn = Object.getOwnPropertyDescriptor(obj, propName).get;
    const fnStr = fn.toString();
    const proxyObj = new Proxy(fn, utils.stripProxyFromErrors(handler));
    utils.replaceProperty(obj, propName, { get: proxyObj });
    utils.patchToString(proxyObj, fnStr);
    return true;
  };

  utils.mockWithProxy = (obj, propName, pseudoTarget, handler) => {
    const proxyObj = new Proxy(pseudoTarget, utils.stripProxyFromErrors(handler));
    utils.replaceProperty(obj, propName, { value: proxyObj });
    utils.patchToString(proxyObj);
    return true;
  };

  utils.createProxy = (pseudoTarget, handler) => {
    const proxyObj = new Proxy(pseudoTarget, utils.stripProxyFromErrors(handler));
    utils.patchToString(proxyObj);
    return proxyObj;
  };

  utils.execRecursively = (obj = {}, typeFilter = [], fn) => {
    function recurse(obj) {
      for (const key in obj) {
        if (obj[key] === undefined) {
          continue;
        }
        if (obj[key] && typeof obj[key] === 'object') {
          recurse(obj[key]);
        } else {
          if (obj[key] && typeFilter.includes(typeof obj[key])) {
            fn.call(this, obj[key]);
          }
        }
      }
    }
    recurse(obj);
    return obj;
  };

  utils.makeHandler = () => ({
    getterValue: value => ({
      apply(target, ctx, args) {
        utils.cache.Reflect.apply(...arguments);
        return value;
      }
    })
  });

  utils.arrayEquals = (array1, array2) => {
    if (array1.length !== array2.length) {
      return false;
    }
    for (let i = 0; i < array1.length; ++i) {
      if (array1[i] !== array2[i]) {
        return false;
      }
    }
    return true;
  };

  utils.memoize = fn => {
    const cache = [];
    return function(...args) {
      if (!cache.some(c => utils.arrayEquals(c.key, args))) {
        cache.push({ key: args, value: fn.apply(this, args) });
      }
      return cache.find(c => utils.arrayEquals(c.key, args)).value;
    };
  };

  // Initialize the utils cache immediately
  utils.init();

  // ============================================================
  // Helper: Ensure window.chrome exists
  // ============================================================
  function ensureChrome() {
    if (!window.chrome) {
      Object.defineProperty(window, 'chrome', {
        writable: true,
        enumerable: true,
        configurable: false,
        value: {}
      });
    }
  }

  // ============================================================
  // 1. chrome.app
  // ============================================================
  (function evasion_chrome_app() {
    ensureChrome();
    if ('app' in window.chrome) {
      return;
    }
    const makeError = {
      ErrorInInvocation: fn => {
        const err = new TypeError('Error in invocation of app.' + fn + '()');
        return utils.stripErrorWithAnchor(err, 'at ' + fn + ' (eval at <anonymous>');
      }
    };
    const STATIC_DATA = {
      isInstalled: false,
      InstallState: {
        DISABLED: 'disabled',
        INSTALLED: 'installed',
        NOT_INSTALLED: 'not_installed'
      },
      RunningState: {
        CANNOT_RUN: 'cannot_run',
        READY_TO_RUN: 'ready_to_run',
        RUNNING: 'running'
      }
    };
    window.chrome.app = {
      ...STATIC_DATA,
      get isInstalled() {
        return false;
      },
      getDetails: function getDetails() {
        if (arguments.length) {
          throw makeError.ErrorInInvocation('getDetails');
        }
        return null;
      },
      getIsInstalled: function getDetails() {
        if (arguments.length) {
          throw makeError.ErrorInInvocation('getIsInstalled');
        }
        return false;
      },
      runningState: function getDetails() {
        if (arguments.length) {
          throw makeError.ErrorInInvocation('runningState');
        }
        return 'cannot_run';
      }
    };
    utils.patchToStringNested(window.chrome.app);
  })();

  // ============================================================
  // 2. chrome.csi
  // ============================================================
  (function evasion_chrome_csi() {
    ensureChrome();
    if ('csi' in window.chrome) {
      return;
    }
    if (!window.performance || !window.performance.timing) {
      return;
    }
    var timing = window.performance.timing;
    window.chrome.csi = function() {
      return {
        onloadT: timing.domContentLoadedEventEnd,
        startE: timing.navigationStart,
        pageT: Date.now() - timing.navigationStart,
        tran: 15
      };
    };
    utils.patchToString(window.chrome.csi);
  })();

  // ============================================================
  // 3. chrome.loadTimes
  // ============================================================
  (function evasion_chrome_loadTimes() {
    ensureChrome();
    if ('loadTimes' in window.chrome) {
      return;
    }
    if (
      !window.performance ||
      !window.performance.timing ||
      !window.PerformancePaintTiming
    ) {
      return;
    }
    var performance = window.performance;
    var ntEntryFallback = {
      nextHopProtocol: 'h2',
      type: 'other'
    };
    var protocolInfo = {
      get connectionInfo() {
        var ntEntry =
          performance.getEntriesByType('navigation')[0] || ntEntryFallback;
        return ntEntry.nextHopProtocol;
      },
      get npnNegotiatedProtocol() {
        var ntEntry =
          performance.getEntriesByType('navigation')[0] || ntEntryFallback;
        return ['h2', 'hq'].includes(ntEntry.nextHopProtocol)
          ? ntEntry.nextHopProtocol
          : 'unknown';
      },
      get navigationType() {
        var ntEntry =
          performance.getEntriesByType('navigation')[0] || ntEntryFallback;
        return ntEntry.type;
      },
      get wasAlternateProtocolAvailable() {
        return false;
      },
      get wasFetchedViaSpdy() {
        var ntEntry =
          performance.getEntriesByType('navigation')[0] || ntEntryFallback;
        return ['h2', 'hq'].includes(ntEntry.nextHopProtocol);
      },
      get wasNpnNegotiated() {
        var ntEntry =
          performance.getEntriesByType('navigation')[0] || ntEntryFallback;
        return ['h2', 'hq'].includes(ntEntry.nextHopProtocol);
      }
    };
    var timing = window.performance.timing;
    function toFixed(num, fixed) {
      var re = new RegExp('^-?\\\\d+(?:\\\\.\\\\d{0,' + (fixed || -1) + '})?');
      return num.toString().match(re)[0];
    }
    var timingInfo = {
      get firstPaintAfterLoadTime() {
        return 0;
      },
      get requestTime() {
        return timing.navigationStart / 1000;
      },
      get startLoadTime() {
        return timing.navigationStart / 1000;
      },
      get commitLoadTime() {
        return timing.responseStart / 1000;
      },
      get finishDocumentLoadTime() {
        return timing.domContentLoadedEventEnd / 1000;
      },
      get finishLoadTime() {
        return timing.loadEventEnd / 1000;
      },
      get firstPaintTime() {
        var fpEntry = performance.getEntriesByType('paint')[0] || {
          startTime: timing.loadEventEnd / 1000
        };
        return toFixed(
          (fpEntry.startTime + performance.timeOrigin) / 1000,
          3
        );
      }
    };
    window.chrome.loadTimes = function() {
      return {
        ...protocolInfo,
        ...timingInfo
      };
    };
    utils.patchToString(window.chrome.loadTimes);
  })();

  // ============================================================
  // 4. chrome.runtime
  // ============================================================
  (function evasion_chrome_runtime() {
    ensureChrome();
    var STATIC_DATA = {
      OnInstalledReason: {
        CHROME_UPDATE: 'chrome_update',
        INSTALL: 'install',
        SHARED_MODULE_UPDATE: 'shared_module_update',
        UPDATE: 'update'
      },
      OnRestartRequiredReason: {
        APP_UPDATE: 'app_update',
        OS_UPDATE: 'os_update',
        PERIODIC: 'periodic'
      },
      PlatformArch: {
        ARM: 'arm',
        ARM64: 'arm64',
        MIPS: 'mips',
        MIPS64: 'mips64',
        X86_32: 'x86-32',
        X86_64: 'x86-64'
      },
      PlatformNaclArch: {
        ARM: 'arm',
        MIPS: 'mips',
        MIPS64: 'mips64',
        X86_32: 'x86-32',
        X86_64: 'x86-64'
      },
      PlatformOs: {
        ANDROID: 'android',
        CROS: 'cros',
        LINUX: 'linux',
        MAC: 'mac',
        OPENBSD: 'openbsd',
        WIN: 'win'
      },
      RequestUpdateCheckStatus: {
        NO_UPDATE: 'no_update',
        THROTTLED: 'throttled',
        UPDATE_AVAILABLE: 'update_available'
      }
    };
    var existsAlready = 'runtime' in window.chrome;
    var isNotSecure = !window.location.protocol.startsWith('https');
    if (existsAlready || isNotSecure) {
      return;
    }
    window.chrome.runtime = {
      ...STATIC_DATA,
      get id() {
        return undefined;
      },
      connect: null,
      sendMessage: null
    };
    var makeCustomRuntimeErrors = (preamble, method, extensionId) => ({
      NoMatchingSignature: new TypeError(
        preamble + 'No matching signature.'
      ),
      MustSpecifyExtensionID: new TypeError(
        preamble +
          method + ' called from a webpage must specify an Extension ID (string) for its first argument.'
      ),
      InvalidExtensionID: new TypeError(
        preamble + "Invalid extension id: '" + extensionId + "'"
      )
    });
    var isValidExtensionID = str =>
      str.length === 32 && str.toLowerCase().match(/^[a-p]+\$/);
    var sendMessageHandler = {
      apply: function(target, ctx, args) {
        var extensionId = args[0];
        var options = args[1];
        var responseCallback = args[2];
        var errorPreamble = 'Error in invocation of runtime.sendMessage(optional string extensionId, any message, optional object options, optional function responseCallback): ';
        var Errors = makeCustomRuntimeErrors(
          errorPreamble,
          'chrome.runtime.sendMessage()',
          extensionId
        );
        var noArguments = args.length === 0;
        var tooManyArguments = args.length > 4;
        var incorrectOptions = options && typeof options !== 'object';
        var incorrectResponseCallback =
          responseCallback && typeof responseCallback !== 'function';
        if (
          noArguments ||
          tooManyArguments ||
          incorrectOptions ||
          incorrectResponseCallback
        ) {
          throw Errors.NoMatchingSignature;
        }
        if (args.length < 2) {
          throw Errors.MustSpecifyExtensionID;
        }
        if (typeof extensionId !== 'string') {
          throw Errors.NoMatchingSignature;
        }
        if (!isValidExtensionID(extensionId)) {
          throw Errors.InvalidExtensionID;
        }
        return undefined;
      }
    };
    utils.mockWithProxy(
      window.chrome.runtime,
      'sendMessage',
      function sendMessage() {},
      sendMessageHandler
    );
    var connectHandler = {
      apply: function(target, ctx, args) {
        var extensionId = args[0];
        var connectInfo = args[1];
        var errorPreamble = 'Error in invocation of runtime.connect(optional string extensionId, optional object connectInfo): ';
        var Errors = makeCustomRuntimeErrors(
          errorPreamble,
          'chrome.runtime.connect()',
          extensionId
        );
        var noArguments = args.length === 0;
        var emptyStringArgument = args.length === 1 && extensionId === '';
        if (noArguments || emptyStringArgument) {
          throw Errors.MustSpecifyExtensionID;
        }
        var tooManyArguments = args.length > 2;
        var incorrectConnectInfoType =
          connectInfo && typeof connectInfo !== 'object';
        if (tooManyArguments || incorrectConnectInfoType) {
          throw Errors.NoMatchingSignature;
        }
        var extensionIdIsString = typeof extensionId === 'string';
        if (extensionIdIsString && extensionId === '') {
          throw Errors.MustSpecifyExtensionID;
        }
        if (extensionIdIsString && !isValidExtensionID(extensionId)) {
          throw Errors.InvalidExtensionID;
        }
        var validateConnectInfo = ci => {
          if (args.length > 1) {
            throw Errors.NoMatchingSignature;
          }
          if (Object.keys(ci).length === 0) {
            throw Errors.MustSpecifyExtensionID;
          }
          Object.entries(ci).forEach(([k, v]) => {
            var isExpected = ['name', 'includeTlsChannelId'].includes(k);
            if (!isExpected) {
              throw new TypeError(
                errorPreamble + "Unexpected property: '" + k + "'."
              );
            }
            var MismatchError = (propName, expected, found) =>
              TypeError(
                errorPreamble +
                  "Error at property '" + propName + "': Invalid type: expected " + expected + ', found ' + found + '.'
              );
            if (k === 'name' && typeof v !== 'string') {
              throw MismatchError(k, 'string', typeof v);
            }
            if (k === 'includeTlsChannelId' && typeof v !== 'boolean') {
              throw MismatchError(k, 'boolean', typeof v);
            }
          });
        };
        if (typeof extensionId === 'object') {
          validateConnectInfo(extensionId);
          throw Errors.MustSpecifyExtensionID;
        }
        return utils.patchToStringNested(makeConnectResponse());
      }
    };
    utils.mockWithProxy(
      window.chrome.runtime,
      'connect',
      function connect() {},
      connectHandler
    );
    function makeConnectResponse() {
      var onSomething = () => ({
        addListener: function addListener() {},
        dispatch: function dispatch() {},
        hasListener: function hasListener() {},
        hasListeners: function hasListeners() {
          return false;
        },
        removeListener: function removeListener() {}
      });
      var response = {
        name: '',
        sender: undefined,
        disconnect: function disconnect() {},
        onDisconnect: onSomething(),
        onMessage: onSomething(),
        postMessage: function postMessage() {
          if (!arguments.length) {
            throw new TypeError('Insufficient number of arguments.');
          }
          throw new Error('Attempting to use a disconnected port object');
        }
      };
      return response;
    }
  })();

  // ============================================================
  // 5. navigator.webdriver
  // ============================================================
  (function evasion_navigator_webdriver() {
    if (navigator.webdriver === false) {
      // Post Chrome 89.0.4339.0 and already good
    } else if (navigator.webdriver === undefined) {
      // Pre Chrome 89.0.4339.0 and already good
    } else {
      // Needs patching
      delete Object.getPrototypeOf(navigator).webdriver;
    }
  })();

  // ============================================================
  // 6. navigator.plugins & navigator.mimeTypes
  // ============================================================
  (function evasion_navigator_plugins() {
    // That means we're running headful
    var hasPlugins = 'plugins' in navigator && navigator.plugins.length;
    if (hasPlugins) {
      return;
    }

    var pluginData = {
      mimeTypes: [
        {
          type: 'application/pdf',
          suffixes: 'pdf',
          description: '',
          __pluginName: 'Chrome PDF Viewer'
        },
        {
          type: 'application/x-google-chrome-pdf',
          suffixes: 'pdf',
          description: 'Portable Document Format',
          __pluginName: 'Chrome PDF Plugin'
        },
        {
          type: 'application/x-nacl',
          suffixes: '',
          description: 'Native Client Executable',
          __pluginName: 'Native Client'
        },
        {
          type: 'application/x-pnacl',
          suffixes: '',
          description: 'Portable Native Client Executable',
          __pluginName: 'Native Client'
        }
      ],
      plugins: [
        {
          name: 'Chrome PDF Plugin',
          filename: 'internal-pdf-viewer',
          description: 'Portable Document Format',
          __mimeTypes: ['application/x-google-chrome-pdf']
        },
        {
          name: 'Chrome PDF Viewer',
          filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
          description: '',
          __mimeTypes: ['application/pdf']
        },
        {
          name: 'Native Client',
          filename: 'internal-nacl-plugin',
          description: '',
          __mimeTypes: ['application/x-nacl', 'application/x-pnacl']
        }
      ]
    };

    // --- generateMagicArray ---
    function generateMagicArray(
      dataArray,
      proto,
      itemProto,
      itemMainProp
    ) {
      var defineProp = (obj, prop, value) =>
        Object.defineProperty(obj, prop, {
          value: value,
          writable: false,
          enumerable: false,
          configurable: true
        });

      var makeItem = data => {
        var item = {};
        for (var prop of Object.keys(data)) {
          if (prop.startsWith('__')) {
            continue;
          }
          defineProp(item, prop, data[prop]);
        }
        return patchItem(item, data);
      };

      var patchItem = (item, data) => {
        var descriptor = Object.getOwnPropertyDescriptors(item);
        if (itemProto === Plugin.prototype) {
          descriptor = {
            ...descriptor,
            length: {
              value: data.__mimeTypes.length,
              writable: false,
              enumerable: false,
              configurable: true
            }
          };
        }
        var obj = Object.create(itemProto, descriptor);
        var blacklist = [...Object.keys(data), 'length', 'enabledPlugin'];
        return new Proxy(obj, {
          ownKeys(target) {
            return Reflect.ownKeys(target).filter(k => !blacklist.includes(k));
          },
          getOwnPropertyDescriptor(target, prop) {
            if (blacklist.includes(prop)) {
              return undefined;
            }
            return Reflect.getOwnPropertyDescriptor(target, prop);
          }
        });
      };

      var magicArray = [];
      dataArray.forEach(data => {
        magicArray.push(makeItem(data));
      });
      magicArray.forEach(entry => {
        defineProp(magicArray, entry[itemMainProp], entry);
      });

      var magicArrayObj = Object.create(proto, {
        ...Object.getOwnPropertyDescriptors(magicArray),
        length: {
          value: magicArray.length,
          writable: false,
          enumerable: false,
          configurable: true
        }
      });

      // --- generateFunctionMocks ---
      var functionMocks = {
        item: utils.createProxy(proto.item, {
          apply(target, ctx, args) {
            if (!args.length) {
              throw new TypeError(
                "Failed to execute 'item' on '" +
                  proto[Symbol.toStringTag] +
                  "': 1 argument required, but only 0 present."
              );
            }
            var isInteger = args[0] && Number.isInteger(Number(args[0]));
            return (isInteger ? magicArray[Number(args[0])] : magicArray[0]) || null;
          }
        }),
        namedItem: utils.createProxy(proto.namedItem, {
          apply(target, ctx, args) {
            if (!args.length) {
              throw new TypeError(
                "Failed to execute 'namedItem' on '" +
                  proto[Symbol.toStringTag] +
                  "': 1 argument required, but only 0 present."
              );
            }
            return magicArray.find(mt => mt[itemMainProp] === args[0]) || null;
          }
        }),
        refresh: proto.refresh
          ? utils.createProxy(proto.refresh, {
              apply(target, ctx, args) {
                return undefined;
              }
            })
          : undefined
      };

      var magicArrayObjProxy = new Proxy(magicArrayObj, {
        get(target, key) {
          if (key === 'item') {
            return functionMocks.item;
          }
          if (key === 'namedItem') {
            return functionMocks.namedItem;
          }
          if (proto === PluginArray.prototype && key === 'refresh') {
            return functionMocks.refresh;
          }
          return utils.cache.Reflect.get(...arguments);
        },
        ownKeys(target) {
          var keys = [];
          var typeProps = magicArray.map(mt => mt[itemMainProp]);
          typeProps.forEach((_, i) => keys.push('' + i));
          typeProps.forEach(propName => keys.push(propName));
          return keys;
        },
        getOwnPropertyDescriptor(target, prop) {
          if (prop === 'length') {
            return undefined;
          }
          return Reflect.getOwnPropertyDescriptor(target, prop);
        }
      });
      return magicArrayObjProxy;
    }

    var mimeTypes = generateMagicArray(
      pluginData.mimeTypes,
      MimeTypeArray.prototype,
      MimeType.prototype,
      'type'
    );
    var plugins = generateMagicArray(
      pluginData.plugins,
      PluginArray.prototype,
      Plugin.prototype,
      'name'
    );

    // Cross-reference plugins and mimeTypes
    for (var pData of pluginData.plugins) {
      pData.__mimeTypes.forEach((type, index) => {
        plugins[pData.name][index] = mimeTypes[type];
        Object.defineProperty(plugins[pData.name], type, {
          value: mimeTypes[type],
          writable: false,
          enumerable: false,
          configurable: true
        });
        Object.defineProperty(mimeTypes[type], 'enabledPlugin', {
          value:
            type === 'application/x-pnacl'
              ? mimeTypes['application/x-nacl'].enabledPlugin
              : new Proxy(plugins[pData.name], {}),
          writable: false,
          enumerable: false,
          configurable: true
        });
      });
    }

    var patchNavigator = (name, value) =>
      utils.replaceProperty(Object.getPrototypeOf(navigator), name, {
        get() {
          return value;
        }
      });
    patchNavigator('mimeTypes', mimeTypes);
    patchNavigator('plugins', plugins);
  })();

  // ============================================================
  // 7. navigator.languages
  // ============================================================
  (function evasion_navigator_languages() {
    utils.replaceGetterWithProxy(
      Object.getPrototypeOf(navigator),
      'languages',
      utils.makeHandler().getterValue(Object.freeze(['en-US', 'en']))
    );
  })();

  // ============================================================
  // 8. navigator.vendor
  // ============================================================
  (function evasion_navigator_vendor() {
    utils.replaceGetterWithProxy(
      Object.getPrototypeOf(navigator),
      'vendor',
      utils.makeHandler().getterValue('Google Inc.')
    );
  })();

  // ============================================================
  // 9. navigator.permissions
  // ============================================================
  (function evasion_navigator_permissions() {
    var isSecure = document.location.protocol.startsWith('https');
    if (isSecure) {
      utils.replaceGetterWithProxy(Notification, 'permission', {
        apply() {
          return 'default';
        }
      });
    }
    if (!isSecure) {
      var handler = {
        apply(target, ctx, args) {
          var param = (args || [])[0];
          var isNotifications =
            param && param.name && param.name === 'notifications';
          if (!isNotifications) {
            return utils.cache.Reflect.apply(...arguments);
          }
          return Promise.resolve(
            Object.setPrototypeOf(
              {
                state: 'denied',
                onchange: null
              },
              PermissionStatus.prototype
            )
          );
        }
      };
      utils.replaceWithProxy(Permissions.prototype, 'query', handler);
    }
  })();

  // ============================================================
  // 10. navigator.hardwareConcurrency
  // ============================================================
  (function evasion_navigator_hardwareConcurrency() {
    utils.replaceGetterWithProxy(
      Object.getPrototypeOf(navigator),
      'hardwareConcurrency',
      utils.makeHandler().getterValue(4)
    );
  })();

  // ============================================================
  // 11. window.outerdimensions
  // ============================================================
  (function evasion_window_outerdimensions() {
    try {
      if (window.outerWidth && window.outerHeight) {
        return;
      }
      var windowFrame = 85;
      window.outerWidth = window.innerWidth;
      window.outerHeight = window.innerHeight + windowFrame;
    } catch (err) {}
  })();

  // ============================================================
  // 12. webgl.vendor
  // ============================================================
  (function evasion_webgl_vendor() {
    var getParameterProxyHandler = {
      apply: function(target, ctx, args) {
        var param = (args || [])[0];
        var result = utils.cache.Reflect.apply(target, ctx, args);
        // UNMASKED_VENDOR_WEBGL
        if (param === 37445) {
          return 'Intel Inc.';
        }
        // UNMASKED_RENDERER_WEBGL
        if (param === 37446) {
          return 'Intel Iris OpenGL Engine';
        }
        return result;
      }
    };
    var addProxy = (obj, propName) => {
      utils.replaceWithProxy(obj, propName, getParameterProxyHandler);
    };
    addProxy(WebGLRenderingContext.prototype, 'getParameter');
    addProxy(WebGL2RenderingContext.prototype, 'getParameter');
  })();

  // ============================================================
  // 13. iframe.contentWindow
  // ============================================================
  (function evasion_iframe_contentWindow() {
    try {
      var addContentWindowProxy = iframe => {
        var contentWindowProxy = {
          get(target, key) {
            if (key === 'self') {
              return this;
            }
            if (key === 'frameElement') {
              return iframe;
            }
            if (key === '0') {
              return undefined;
            }
            return Reflect.get(target, key);
          }
        };
        if (!iframe.contentWindow) {
          var proxy = new Proxy(window, contentWindowProxy);
          Object.defineProperty(iframe, 'contentWindow', {
            get() {
              return proxy;
            },
            set(newValue) {
              return newValue;
            },
            enumerable: true,
            configurable: false
          });
        }
      };
      var handleIframeCreation = (target, thisArg, args) => {
        var iframe = target.apply(thisArg, args);
        var _iframe = iframe;
        var _srcdoc = _iframe.srcdoc;
        Object.defineProperty(iframe, 'srcdoc', {
          configurable: true,
          get: function() {
            return _srcdoc;
          },
          set: function(newValue) {
            addContentWindowProxy(this);
            Object.defineProperty(iframe, 'srcdoc', {
              configurable: false,
              writable: false,
              value: _srcdoc
            });
            _iframe.srcdoc = newValue;
          }
        });
        return iframe;
      };
      var addIframeCreationSniffer = () => {
        var createElementHandler = {
          get(target, key) {
            return Reflect.get(target, key);
          },
          apply: function(target, thisArg, args) {
            var isIframe =
              args && args.length && ('' + args[0]).toLowerCase() === 'iframe';
            if (!isIframe) {
              return target.apply(thisArg, args);
            } else {
              return handleIframeCreation(target, thisArg, args);
            }
          }
        };
        utils.replaceWithProxy(
          document,
          'createElement',
          createElementHandler
        );
      };
      addIframeCreationSniffer();
    } catch (err) {}
  })();

  // ============================================================
  // 14. sourceurl - note: this evasion patches CDP on the Node side,
  // so we provide a no-op in the browser. The actual sourceurl stripping
  // must be done externally by intercepting CDP client.send().
  // (included here as a placeholder; see applySourceUrlPatch below)
  // ============================================================

})();`;
