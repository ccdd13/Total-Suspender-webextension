/* eslint no-underscore-dangle: 0 */

import _ from 'lodash';
import { saveToStorage, loadFromStorage, stringToRegex } from '../utils';

class TabSuspender {
  constructor() {
    this.action = null;
    this.console = console;
    this.discardEventEmitter = document;

    // NOTE: actions are applied sequentially,
    // modifiedTabs contain tabs changed in preceding actions, return them in actions!
    // only modifiedTabs are meant to be changed
    this.config = [
      {
        id: 'default',
        action: () => () => (rawTabs, modifiedTabs = rawTabs) => modifiedTabs
          .filter(tab => !tab.active && !tab.discarded)
          .sort((a, b) => a.lastAccessed - b.lastAccessed),
        isEnabled: () => true,
      },
      {
        id: '#input-suspend-all-planned',
        action: () => () => (rawTabs, modifiedTabs = rawTabs) => {
          this.console.log('suspending all on planned', modifiedTabs);
          browser.tabs.discard(modifiedTabs.map(tab => tab.id));
          // better make action generator accept async functions since this
          // below can cause unexpected behaviour
          saveToStorage({ '#input-suspend-all-planned': false });
          return modifiedTabs;
        },
        isEnabled: value => typeof value === 'boolean' && value,
        defaultValue: false,
      },
      {
        id: '#input-ignore-audible',
        action:
          () => () => (rawTabs, modifiedTabs = rawTabs) => modifiedTabs.filter(tab => !tab.audible),
        isEnabled: value => typeof value === 'boolean' && value,
        defaultValue: false,
      },
      {
        id: '#input-ignore-pinned',
        action:
          () => () => (rawTabs, modifiedTabs = rawTabs) => modifiedTabs.filter(tab => !tab.pinned),
        isEnabled: value => typeof value === 'boolean' && value,
        defaultValue: true,
      },
      {
        id: '#input-whitelist-pattern',
        action: value => () => (rawTabs, modifiedTabs = rawTabs) => {
          // check for those updating from previous versions
          // since trying to load value from storage by non-existing key returns empty object
          const set = (value && value instanceof Set);

          const strings = new Set();
          const regex = new Set();

          const regexMarker = '\\regex\\';
          if (set) {
            // Each item can be either string or regex, starting with \regex\
            // Populate strings and regex sets based on it
            value.forEach((item) => {
              if (_.startsWith(item, regexMarker)) {
                regex.add(item.slice(regexMarker.length));
              } else {
                strings.add(item);
              }
            });
          }

          this.console.log('whitelist', set, strings, regex);
          this._whitelistPatternsStrings = strings;
          this._whitelistPatternsRegex = regex;

          return modifiedTabs;
        },
        isEnabled: () => true,
      },
      {
        id: '#input-enable-whitelist',
        action: () => () => (rawTabs, modifiedTabs = rawTabs) => {
          this.console.log('input-enable-whitelist', modifiedTabs);
          const strings = (this._whitelistPatternsStrings instanceof Set)
            ? [...this._whitelistPatternsStrings]
            : [];

          const regex = (this._whitelistPatternsRegex instanceof Set)
            ? [...this._whitelistPatternsRegex]
            : [];

          return modifiedTabs.filter((tab) => {
            // we need to get only those tabs, that DO NOT match any of pattern strings and regex
            const inStrings = strings.findIndex(pattern => tab.url.includes(pattern)) !== -1;
            // better compile re in whitelist-pattern
            const inRegex = _.some(regex, (str) => {
              const re = stringToRegex(str);
              return tab.url.search(re) !== -1;
            });
            return !(inStrings || inRegex);
          });
        },
        isEnabled: value => typeof value === 'boolean' && value,
        defaultValue: false,
      },
      {
        id: '#input-blacklist-pattern',
        action: value => () => (rawTabs, modifiedTabs = rawTabs) => {
          // check for those updating from previous versions
          // since trying to load value from storage by non-existing key returns empty object
          const set = (value && value instanceof Set);

          const strings = new Set();
          const regex = new Set();

          const regexMarker = '\\regex\\';
          if (set) {
            // Each item can be either string or regex, starting with \regex\
            // Populate strings and regex sets based on it
            value.forEach((item) => {
              if (_.startsWith(item, regexMarker)) {
                regex.add(item.slice(regexMarker.length));
              } else {
                strings.add(item);
              }
            });
          }

          this.console.log('blacklist', set, strings, regex);
          this._blacklistPatternsStrings = strings;
          this._blacklistPatternsRegex = regex;

          return modifiedTabs;
        },
        isEnabled: () => true,
      },
      {
        id: '#input-enable-blacklist',
        action: () => () => (rawTabs, modifiedTabs = rawTabs) => {
          const strings = (this._blacklistPatternsStrings instanceof Set)
            ? [...this._blacklistPatternsStrings]
            : [];

          const regex = (this._blacklistPatternsRegex instanceof Set)
            ? [...this._blacklistPatternsRegex]
            : [];

          // NOTE: if both lists are empty, we simply return modifiedTabs
          // to suspend all of them istead of suspending none.
          if (!strings.length && !regex.length) {
            return modifiedTabs;
          }

          return modifiedTabs.filter((tab) => {
            // we need to get only those tabs, that DO match a pattern in strings or regex
            const inStrings = strings.findIndex(pattern => tab.url.includes(pattern)) !== -1;
            // better compile re in whitelist-pattern
            const inRegex = _.some(regex, (str) => {
              const re = stringToRegex(str);
              return tab.url.search(re) !== -1;
            });
            return inStrings || inRegex;
          });
        },
        isEnabled: value => typeof value === 'boolean' && value,
        defaultValue: false,
      },
      {
        id: '#input-suspend-threshold',
        action: value => () => (rawTabs, modifiedTabs = rawTabs) => {
          if (modifiedTabs.length < value) {
            return [];
          }
          const rest = modifiedTabs.slice(0, modifiedTabs.length - value);
          this.console.log('thresholding', modifiedTabs, rest);
          return rest;
        },
        isEnabled: value => !Number.isNaN(value) && value > 0,
        defaultValue: 1, // number of loaded tabs
      },
      {
        id: '#input-suspend-planned',
        action: () => () => (rawTabs, modifiedTabs = rawTabs) => {
          this.console.log('suspending on planned', modifiedTabs);
          browser.tabs.discard(modifiedTabs.map(tab => tab.id));
          // Better make action generator accept async functions since this
          // below can cause unexpected behaviour
          saveToStorage({ '#input-suspend-planned': false });
          return modifiedTabs;
        },
        isEnabled: value => typeof value === 'boolean' && value,
        defaultValue: false,
      },
      {
        id: '#input-disable-suspension', // it should be placed before any automatic discard
        action:
          () => () => () => [], // just return empty modified tabs to prevent any further actions
        isEnabled: value => typeof value === 'boolean' && value,
        defaultValue: false,
      },
      {
        id: '#input-delay-suspend',
        action: value => () => (rawTabs, modifiedTabs = rawTabs) => {
          const ms = value * 1000;

          if (!this.delaySuspendTimeoutIds) {
            this.delaySuspendTimeoutIds = [];
          }

          // remove the timeout if the tab is not present in filter results
          const rest = rawTabs
            .filter(rawTab => modifiedTabs.findIndex(modTab => modTab.id === rawTab.id) === -1);

          rest.forEach((tab) => {
            if (!this.delaySuspendTimeoutIds[tab.id]) {
              return;
            }
            clearTimeout(this.delaySuspendTimeoutIds[tab.id]);
            this.delaySuspendTimeoutIds[tab.id] = null;
          });

          // TODO: add check for removed?
          // TODO: somehow process loading tabs
          modifiedTabs.forEach((tab) => {
            if (this.delaySuspendTimeoutIds[tab.id]) {
              return;
            }
            this.console.log('setting timeout for', tab.id);
            const delaySuspendTimeoutId = setTimeout(() => {
              this.console.log('time is out for tab', tab.id);
              browser.tabs.discard(tab.id);
              this.delaySuspendTimeoutIds[tab.id] = null;
            }, ms);

            this.delaySuspendTimeoutIds[tab.id] = delaySuspendTimeoutId;
          });

          return modifiedTabs;
        },
        isEnabled: value => !Number.isNaN(value) && value > 0,
        defaultValue: 60, // value provided in seconds
      },
      {
        id: 'updateBadgeText',
        action: () => actionInfo => (rawTabs, modifiedTabs = rawTabs) => {
          browser.tabs.query({}).then((tabs) => {
            if (actionInfo.type !== 'activated') {
              const removed = actionInfo.type === 'removed';
              const { isWindowClosing } = actionInfo;
              const tabsCount = (removed && !isWindowClosing) ? tabs.length - 1 : tabs.length;

              browser.browserAction.setBadgeText({ text: tabsCount.toString() });
              browser.browserAction.setBadgeTextColor({ color: [255, 255, 255, 255] });
              browser.browserAction.setBadgeBackgroundColor({ color: [64, 64, 64, 255] });
            }
          });
          return modifiedTabs;
        },
        isEnabled: () => true,
      },
    ];

    this.tabHandlers = {
      onCreated: tab => this.discard({ type: 'created', id: tab.id }),
      onActivated: ({ tabId }) => this.discard({ type: 'activated', id: tabId }),
      onRemoved: (tabId, removeInfo) => {
        const { isWindowClosing } = removeInfo;
        this.discard({ type: 'removed', id: tabId, isWindowClosing });
      },
      onUpdated: (tabId, change) => {
        // TODO: change, add args in addListener to listen to specific changes
        if (!change.audible) {
          return;
        }
        this.discard({ type: 'updated', id: tabId });
      },
      onAttached: tabId => this.discard({ type: 'attached', id: tabId }),
      onDetached: tabId => this.discard({ type: 'detached', id: tabId }),
    };
  }

  // Emits events that trigger this.config calls
  discard(payload) {
    const event = new CustomEvent('discard', { detail: payload });
    this.discardEventEmitter.dispatchEvent(event);
  }

  handleAction(actionInfo) {
    browser.tabs.query({}).then((tabs) => {
      this.action(actionInfo)(tabs);
    });
  }

  async updateConfig() {
    const loadedOptions = await Promise.all(this.config.map(async (option) => {
      const { id, defaultValue } = option;
      const data = await loadFromStorage(id);
      const value = data[id] !== undefined ? data[id] : defaultValue;
      return { ...option, value };
    }));

    this.config = loadedOptions;
    this.console.log('config changed', this.config);
  }

  generateAction() {
    const activeOptions = this.config.filter(option => option.isEnabled(option.value));

    this.console.log('active options', activeOptions, this.config);
    const mergedActions = activeOptions.reduceRight(
      (acc, cur) => actionInfo => (rawTabs, modTabs) => {
        const newModTabs = cur.action(cur.value)(actionInfo)(rawTabs, modTabs);
        return acc(actionInfo)(rawTabs, newModTabs);
      },
      () => rawTabs => rawTabs,
    );

    this.action = mergedActions;
  }

  createContextMenus() {
    // TODO: refactor, separate creating menus, attaching listener and listener
    browser.menus.create({
      id: 'total-suspender-suspend',
      title: 'Suspend',
      contexts: ['tab'],
    });

    browser.menus.create({
      id: 'total-suspender-whitelist-page',
      title: 'Whitelist',
      contexts: ['tab'],
    });

    browser.menus.create({
      id: 'total-suspender-whitelist-domain',
      title: 'Whitelist domain',
      contexts: ['tab'],
    });

    browser.menus.create({
      id: 'total-suspender-blacklist-page',
      title: 'Blacklist',
      contexts: ['tab'],
    });

    browser.menus.create({
      id: 'total-suspender-blacklist-domain',
      title: 'Blacklist domain',
      contexts: ['tab'],
    });

    browser.menus.onClicked.addListener((info, tab) => {
      if (!(this._blacklistPatternsStrings instanceof Set)) {
        this._blacklistPatternsStrings = new Set();
      }
      if (!(this._whitelistPatternsStrings instanceof Set)) {
        this._whitelistPatternsStrings = new Set();
      }

      switch (info.menuItemId) {
        case 'total-suspender-suspend': {
          browser.tabs.discard(tab.id);
          break;
        }
        case 'total-suspender-whitelist-page': {
          this._whitelistPatternsStrings.add(tab.url);
          saveToStorage({ '#input-whitelist-pattern': this._whitelistPatternsStrings });
          break;
        }
        case 'total-suspender-whitelist-domain': {
          const { origin } = (new URL(tab.url));
          if (origin === 'null') {
            return;
          }
          this._whitelistPatternsStrings.add(origin);
          saveToStorage({ '#input-whitelist-pattern': this._whitelistPatternsStrings });
          break;
        }
        case 'total-suspender-blacklist-page': {
          this._blacklistPatternsStrings.add(tab.url);
          saveToStorage({ '#input-blacklist-pattern': this._blacklistPatternsStrings });
          break;
        }
        case 'total-suspender-blacklist-domain': {
          const { origin } = (new URL(tab.url));
          if (origin === 'null') {
            return;
          }
          this._blacklistPatternsStrings.add(origin);
          saveToStorage({ '#input-blacklist-pattern': this._blacklistPatternsStrings });
          break;
        }
        default:
      }
    });
  }

  registerHandlers() {
    // handle tab actions
    Object.keys(this.tabHandlers)
      .forEach(event => browser.tabs[event].addListener(this.tabHandlers[event]));

    this.discardEventEmitter.addEventListener('discard', (e) => {
      const { detail } = e;
      this.console.log('event', detail.type, detail.id);
      this.handleAction(detail);
    }, false);

    // reload config after every change
    browser.storage.onChanged.addListener(async () => {
      await this.updateConfig();
      this.generateAction();
      this.discard({ type: 'configChange' });
    });
  }

  async run() {
    this.updateConfig = this.updateConfig.bind(this);
    await this.updateConfig();
    this.generateAction();
    this.registerHandlers();
    this.createContextMenus();
  }
}

export default TabSuspender;
