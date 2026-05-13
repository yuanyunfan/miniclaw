export interface EastmoneyMyfavorCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
}

export interface EastmoneyMyfavorSession {
  version: 1;
  profile?: string;
  host: "myfavor.eastmoney.com";
  created_at?: string;
  last_verified_at?: string;
  source?: string;
  cookies: EastmoneyMyfavorCookie[];
  fingerprint?: Record<string, unknown>;
}

export interface EastmoneyMyfavorProfileConfig {
  account_alias: string;
  base_url: string;
  appkey: string;
  session_secret_path: string;
  browser_profile_dir: string;
  timeout_ms: number;
}

export interface EastmoneyMyfavorConfig {
  profiles: Record<string, EastmoneyMyfavorProfileConfig>;
}

export interface EastmoneyMyfavorGroup {
  gid: string;
  gname: string;
}

export interface EastmoneyMyfavorSecurity {
  group_id: string;
  group_name: string;
  security: string;
  code: string;
  name?: string;
  market_flag?: string;
}
