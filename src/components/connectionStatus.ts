import App from '@config/app';
import DEBUG from '@config/debug';
import {LangPackKey, i18n} from '@lib/langPack';
import {logger} from '@lib/logger';
import rootScope from '@lib/rootScope';
import {ConnectionStatus} from '@lib/mtproto/connectionStatus';
import cancelEvent from '@helpers/dom/cancelEvent';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import {AppManagers} from '@lib/managers';
import singleInstance from '@lib/singleInstance';
import InputSearch from '@components/inputSearch';

const NO_STATUS = false;
const TEST_DBLCLICK = false;
const HAVE_RECONNECT_BUTTON = false;

export default class ConnectionStatusComponent {
  public static CHANGE_STATE_DELAY = 400;
  public static INITIAL_DELAY = 2000;
  public static ANIMATION_DURATION = 250;

  private hadConnect = false;
  private retryAt: number;
  private connecting = false;
  private timedOut = false;
  private updating = false;

  private log: ReturnType<typeof logger>;

  private setFirstConnectionTimeout: number;
  private setStateTimeout: number;

  private managers: AppManagers;
  private inputSearch: InputSearch;
  private rAF: number;
  private dispatchingConnectionStatusChange = false;
  private currentDcId: number;
  private currentConnectionStatus: ConnectionStatus;

  private dispatchConnectionStatusChange(status: ConnectionStatus, retryAt?: number, dcId: number = App.baseDcId) {
    this.dispatchingConnectionStatusChange = true;
    try {
      rootScope.dispatchEvent('connection_status_change', {
        _: 'networkerStatus',
        status,
        dcId,
        name: 'NET-' + dcId,
        isFileNetworker: false,
        isFileDownload: false,
        isFileUpload: false,
        retryAt
      });
    } finally {
      this.dispatchingConnectionStatusChange = false;
    }
  }

  public construct(
    managers: AppManagers,
    chatsContainer: HTMLElement,
    inputSearch: InputSearch
  ) {
    this.managers = managers;
    this.inputSearch = inputSearch;
    this.log = logger('CS', undefined, undefined);
    this.inputSearch.setPlaceholder('Search');

    rootScope.addEventListener('connection_status_change', (status) => {
      if(this.dispatchingConnectionStatusChange) {
        return;
      }
      // console.log(status);

      this.setConnectionStatus();
    });

    rootScope.addEventListener('state_synchronizing', () => {
      this.updating = true;
      this.currentConnectionStatus = ConnectionStatus.Connecting;
      DEBUG && this.log('updating', this.updating);
      this.setState();
    });

    rootScope.addEventListener('state_synchronized', () => {
      DEBUG && this.log('state_synchronized');
      this.updating = false;
      this.currentConnectionStatus = ConnectionStatus.Connected;
      DEBUG && this.log('updating', this.updating);
      this.setState();
    });

    this.setFirstConnectionTimeout = window.setTimeout(
      this.setConnectionStatus,
      ConnectionStatusComponent.INITIAL_DELAY
    );

    if(TEST_DBLCLICK) {
      let bool = true;
      document.addEventListener('dblclick', () => {
        this.setConnectionStatus(bool ? (
            bool = false,
            ConnectionStatus.Closed
          ) : (
            bool = true,
            this.updating = false,
            ConnectionStatus.Connected
          )
        );
      });
    }
  }

  private setConnectionStatus = (overrideStatus?: ConnectionStatus) => {
    Promise.all([
      rootScope.managers.apiManager.getBaseDcId(),
      rootScope.managers.rootScope.getConnectionStatus()
    ]).then(([baseDcId, connectionStatus]) => {
      if(!baseDcId) {
        baseDcId = App.baseDcId;
      }

      if(this.setFirstConnectionTimeout) {
        clearTimeout(this.setFirstConnectionTimeout);
        this.setFirstConnectionTimeout = 0;
      }

      const status = connectionStatus['NET-' + baseDcId];
      const online = status && (overrideStatus ?? status.status) === ConnectionStatus.Connected;

      if(this.connecting && online) {
        this.managers.apiUpdatesManager.forceGetDifference();
      }

      if(online && !this.hadConnect) {
        this.hadConnect = true;
      }

      const effectiveStatus = overrideStatus ?? status?.status ?? ConnectionStatus.Closed;
      this.timedOut = status && effectiveStatus === ConnectionStatus.TimedOut;
      this.connecting = !online;
      this.retryAt = status && status.retryAt;
      this.currentDcId = baseDcId;
      this.currentConnectionStatus = effectiveStatus;
      DEBUG && this.log('connecting', this.connecting);
      this.setState();
    });
  };

  private wrapSetStatusText = (...args: Parameters<InputSearch['setPlaceholder']>) => {
    return () => {
      return this.inputSearch.setPlaceholder(...args);
    };
  };

  private getA(langPackKey: LangPackKey, callback: () => void) {
    const a = document.createElement('a');
    a.classList.add('force-reconnect');
    a.append(i18n(langPackKey));
    attachClickEvent(a, (e) => {
      cancelEvent(e);
      callback();
    });

    return a;
  }

  private setState = () => {
    if(singleInstance.deactivatedReason) {
      return;
    }

    let setText: () => void;
    if(this.connecting) {
      if(this.timedOut) {
        // const a = this.getA('ConnectionStatus.ForceReconnect', () => this.managers.networkerFactory.forceReconnect());
        // setText = this.wrapSetStatusText('ConnectionStatus.TimedOut', [a]);
        setText = this.wrapSetStatusText('Updating');
      } else if(this.hadConnect) {
        if(this.retryAt !== undefined) {
          const timerSpan = document.createElement('span');
          const retryAt = this.retryAt;
          const setTime = () => {
            const now = Date.now();
            timerSpan.innerText = '' + Math.max(0, Math.round((retryAt - now) / 1000));
            if(now > retryAt) {
              clearInterval(interval);
            }
          };
          const interval = setInterval(setTime, 1e3);
          setTime();

          if(HAVE_RECONNECT_BUTTON) {
            const a = this.getA('ConnectionStatus.Reconnect', () => this.managers.networkerFactory.forceReconnectTimeout());
            setText = this.wrapSetStatusText('ConnectionStatus.ReconnectIn', [timerSpan, a]);
          } else {
            setText = this.wrapSetStatusText('ConnectionStatus.ReconnectInPlain', [timerSpan]);
          }
        } else {
          setText = this.wrapSetStatusText('ConnectionStatus.Reconnecting');
        }
      } else {
        setText = this.wrapSetStatusText('ConnectionStatus.Waiting');
      }
    } else if(this.updating) {
      setText = this.wrapSetStatusText('Updating');
    } else {
      setText = this.wrapSetStatusText('Search');
    }

    DEBUG && this.log('setState', this.connecting || this.updating);
    if(this.rAF) window.cancelAnimationFrame(this.rAF);
    this.rAF = window.requestAnimationFrame(() => {
      this.rAF = 0;
      if(this.setStateTimeout) clearTimeout(this.setStateTimeout);

      const wasVisible = this.inputSearch.isLoading();
      const cb = () => {
        if(NO_STATUS) {
          return;
        }

        setText();
        const isConnecting = this.connecting || this.updating;
        this.inputSearch.toggleLoading(isConnecting);
        this.dispatchConnectionStatusChange(
          isConnecting ? (this.currentConnectionStatus ?? ConnectionStatus.Connecting) : ConnectionStatus.Connected,
          this.retryAt,
          this.currentDcId
        );
        this.setStateTimeout = 0;
        DEBUG && this.log('setState: isShown:', isConnecting);
      };

      if(wasVisible) {
        cb();
      } else {
        this.setStateTimeout = window.setTimeout(cb, ConnectionStatusComponent.CHANGE_STATE_DELAY);
      }
    });
  };
}
