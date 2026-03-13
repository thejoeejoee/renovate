export interface PypiJSONRelease {
  requires_python?: string;
  upload_time?: string;
  yanked?: boolean;
}
export type Releases = Record<string, PypiJSONRelease[]>;
export interface PypiJSON {
  info: {
    name: string;
    home_page?: string;
    project_urls?: Record<string, string>;
  };

  releases?: Releases;
}

export interface SimpleApiFile {
  filename: string;
  url: string;
  hashes: Record<string, string>;
  'requires-python'?: string;
  'upload-time'?: string;
  yanked?: string | boolean;
}

export interface SimpleApiJSON {
  meta: { 'api-version': string };
  name: string;
  versions: string[];
  files: SimpleApiFile[];
}
