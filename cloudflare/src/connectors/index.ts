import { Env, SourceRow, WATCH_ONLY } from '../types';
import { BaseConnector } from './base';
import { RSSConnector } from './rss';
import { WebsiteConnector } from './website';
import { YouTubeConnector } from './youtube';
import { TelegramConnector } from './telegram';
import { InstagramProConnector } from './instagram_pro';
import { XBrowserConnector } from './x_browser';

type ConnectorClass = new (source: SourceRow, env: Env) => BaseConnector;

const REGISTRY: Record<string, ConnectorClass> = {
  rss: RSSConnector,
  website: WebsiteConnector,
  youtube: YouTubeConnector,
  x_browser: XBrowserConnector,
  telegram: TelegramConnector,
  instagram_pro: InstagramProConnector,
};

export function getConnector(source: SourceRow, env: Env): BaseConnector {
  if (WATCH_ONLY.has(source.connector_type)) {
    throw new Error(`${source.connector_type} is watch-only — no automated fetch`);
  }
  const Cls = REGISTRY[source.connector_type];
  if (!Cls) throw new Error(`Unknown connector type: ${source.connector_type}`);
  return new Cls(source, env);
}
