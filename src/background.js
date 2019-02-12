/* global bconsole */

const loadFromStorage = (key = null) => browser.storage.local.get(key);

class TabSuspender {
  constructor() {
    this.action = null;
  }

  handleAction(actionInfo) {
    browser.tabs.query({}).then((tabs) => {
      this.action(actionInfo)(tabs);
    });
  }

  get config() {
    // NOTE: actions are applied sequentially,
    // modifiedTabs contain tabs changed in preceding actions, return them in actions!
    return [
      {
        id: 'default',
        action: () => () => (raw, modified = raw) => modified
          .filter(tab => !tab.active && !tab.discarded),
        isEnabled: () => true,
      },
      {
        id: '#input-ignore-audible',
        action: () => () => (raw, modified = raw) => modified.filter(tab => !tab.audible),
        isEnabled: value => typeof value === 'boolean' && value,
        defaultValue: false,
      },
      {
        id: '#input-delay-suspend',
        action: value => () => (rawTabs, modifiedTabs = rawTabs) => {
          const ms = parseInt(value, 10) * 1000;

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
            bconsole.log('setting timeout for', tab.id);
            const delaySuspendTimeoutId = setTimeout(() => {
              bconsole.log('time is out for tab', tab.id);
              browser.tabs.discard(tab.id);
              this.delaySuspendTimeoutIds[tab.id] = null;
            }, ms);

            this.delaySuspendTimeoutIds[tab.id] = delaySuspendTimeoutId;
          });
        },
        isEnabled: value => !Number.isNaN(parseInt(value, 10)) && parseInt(value, 10) >= 1,
        defaultValue: '60', // value provided in seconds
      },
    ];
  }

  async updateConfig() {
    const loadedOptions = await Promise.all(this.config.map(async (option) => {
      const { id, defaultValue } = option;
      const value = (await loadFromStorage(id))[id] || defaultValue;
      return { ...option, value };
    }));

    const activeOptions = loadedOptions.filter(option => option.isEnabled(option.value));

    const mergedActions = activeOptions.reduceRight(
      (acc, cur) => actionInfo => (rawTabs, modTabs) => {
        const newModTabs = cur.action(cur.value)(actionInfo)(rawTabs, modTabs);
        return acc(actionInfo)(rawTabs, newModTabs);
      },
      () => rawTabs => rawTabs,
    );

    this.action = mergedActions;
  }

  get tabHandlers() {
    return {
      onCreated: (tab) => {
        bconsole.log(`tab ${tab.id} created`);
        this.handleAction({ type: 'created', id: tab.id });
      },
      onActivated: ({ tabId }) => {
        bconsole.log(`tab ${tabId} activated`);
        this.handleAction({ type: 'activated', id: tabId });
      },
      onUpdated: (tabId, change) => {
        // TODO: change, add args in addListener to listen to specific changes
        if (change.audible) {
          bconsole.log(`tab ${tabId} updated`, change);
          this.handleAction({ type: 'updated', id: tabId });
        }
      },
    };
  }

  registerHandlers() {
    // handle tab actions
    Object.keys(this.tabHandlers)
      .forEach(event => browser.tabs[event].addListener(this.tabHandlers[event]));

    // reload config after every change
    browser.storage.onChanged.addListener(this.updateConfig);
  }

  async run() {
    this.updateConfig = this.updateConfig.bind(this);
    this.registerHandlers = this.registerHandlers.bind(this);
    this.handleAction = this.handleAction.bind(this);
    await this.updateConfig();
    this.registerHandlers();
  }
}

const tabSuspender = new TabSuspender();
tabSuspender.run();
