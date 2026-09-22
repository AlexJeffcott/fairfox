/**
 * The releases of the Fly app, as `fly releases --json` prints them, newest
 * first. What deploy and rollback decide on (M4, C6). Pure: the text is the
 * argument, and a shape that is not a list of releases is refused, field by
 * field.
 */
export type Release = {
  id: string;
  version: number;
  /** `complete` for a release that went through. */
  status: string;
  createdAt: string;
  /** The image the release runs: `registry.fly.io/fairfox:<tag>`. */
  imageRef: string;
};

function field(entry: object, name: string, index: number): unknown {
  const value: unknown = Reflect.get(entry, name);
  if (value === undefined || value === null) {
    throw new Error(`Release ${index} of fly releases --json has no ${name}`);
  }
  return value;
}

function text(entry: object, name: string, index: number): string {
  const value = field(entry, name, index);
  if (typeof value !== 'string') {
    throw new Error(`Release ${index} of fly releases --json has a ${name} that is not a string`);
  }
  return value;
}

export function parseReleases(json: string): Release[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error('fly releases --json did not print a list');
  }
  return parsed.map((entry: unknown, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Release ${index} of fly releases --json is not an object`);
    }
    const version = field(entry, 'Version', index);
    if (typeof version !== 'number') {
      throw new Error(`Release ${index} of fly releases --json has a Version that is not a number`);
    }
    if (!Number.isInteger(version)) {
      throw new Error(`Release ${index} of fly releases --json has a Version that is not a whole number`);
    }
    return {
      id: text(entry, 'ID', index),
      version,
      status: text(entry, 'Status', index),
      createdAt: text(entry, 'CreatedAt', index),
      imageRef: text(entry, 'ImageRef', index),
    };
  });
}

/** The newest release: the first, once sorted by version. Undefined for an app with none. */
export function newest(releases: readonly Release[]): Release | undefined {
  return [...releases].sort((a, b) => b.version - a.version)[0];
}
