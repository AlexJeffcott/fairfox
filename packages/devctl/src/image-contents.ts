/**
 * What the production image is allowed to hold, and how to read what it does
 * hold. `devctl image` builds the image and calls these (C7).
 */

/** Where Bun's isolated install puts the packages it materialises, read from /app. */
export const STORE = 'node_modules/.bun';

/**
 * Every package the production image may hold, and what put it there. The
 * image holds what production runs and nothing else (C7, `devlocal` DL1): a
 * development tool belongs on a developer's machine, so one is never an entry
 * to add here. It is a defect to fix in the Dockerfile or in .dockerignore.
 *
 * `devctl image` lists the store of the image it built and looks up every
 * name in this table. It fails on a name the table does not hold, and on a
 * name the table holds that the image does not, so the table and the image
 * are made to agree in the same commit that moves them apart. A reason names
 * what pulls the package in, not what the package does.
 */
// Stryker disable next-line ObjectLiteral: the table is data, not logic. What proves it is `devctl image` against a built image, and a unit test that repeated the names would only repeat them
export const IMAGE_PACKAGES: Readonly<Record<string, string>> = {
  elysia: 'the one runtime dependency packages/server declares',
  cookie: 'elysia',
  'exact-mirror': 'elysia',
  'fast-decode-uri-component': 'elysia',
  memoirist: 'elysia',
  '@sinclair/typebox': "elysia's peer, and elysia reads it at run time: the server does not start without it",
  'file-type': "elysia's peer",
  'openapi-types': "elysia's peer",
  '@tokenizer/inflate': 'file-type',
  strtok3: 'file-type',
  'token-types': 'file-type',
  'uint8array-extras': 'file-type',
  '@tokenizer/token': 'strtok3 and @tokenizer/inflate',
  '@borewit/text-codec': 'token-types',
  ieee754: 'token-types',
  debug: '@tokenizer/inflate',
  ms: 'debug',
  // Step 0c: werift, for the server end of check 5. The last deploy of 0c
  // removes the check and these rows with it.
  werift: 'a runtime dependency of packages/server at step 0c, for the server end of check 5',
  '@fidm/x509': 'werift',
  '@fidm/asn1': '@fidm/x509',
  '@noble/curves': 'werift',
  '@noble/hashes': '@noble/curves',
  '@peculiar/x509': 'werift',
  '@peculiar/asn1-cms': '@peculiar/x509',
  '@peculiar/asn1-csr': '@peculiar/x509',
  '@peculiar/asn1-ecc': '@peculiar/x509',
  '@peculiar/asn1-pkcs9': '@peculiar/x509',
  '@peculiar/asn1-pfx': '@peculiar/asn1-pkcs9',
  '@peculiar/asn1-pkcs8': '@peculiar/asn1-pfx and @peculiar/asn1-pkcs9',
  '@peculiar/asn1-rsa': '@peculiar/x509',
  '@peculiar/asn1-schema': '@peculiar/x509 and the other @peculiar/asn1 packages',
  '@peculiar/asn1-x509': '@peculiar/x509 and the other @peculiar/asn1 packages',
  '@peculiar/asn1-x509-attr': '@peculiar/asn1-cms and @peculiar/asn1-pkcs9',
  '@peculiar/utils': '@peculiar/asn1-schema and @peculiar/asn1-x509',
  asn1js: 'the @peculiar/asn1 packages',
  pvtsutils: '@peculiar/x509 and asn1js',
  pvutils: 'asn1js',
  'reflect-metadata': '@peculiar/x509',
  tsyringe: '@peculiar/x509',
  tslib: 'the @peculiar packages, asn1js, pvtsutils and tsyringe',
  '@shinyoshiaki/binary-data': 'werift',
  'generate-function': '@shinyoshiaki/binary-data',
  'is-property': 'generate-function',
  'is-plain-object': '@shinyoshiaki/binary-data',
  isobject: 'is-plain-object',
  buffer: 'werift',
  'base64-js': 'buffer',
  mediabunny: 'werift',
  'multicast-dns': 'werift',
  'dns-packet': 'multicast-dns',
  '@leichtgewicht/ip-codec': 'dns-packet',
  thunky: 'multicast-dns',
  tweetnacl: 'werift and @fidm/x509',
};

/**
 * The package a store directory holds, or undefined when the directory holds
 * no package. Bun names each directory `<name>@<version>`, with the `/` of a
 * scope written `+` and sometimes a hash after the version:
 * `elysia@1.4.30+4aedaac2516c6428` is `elysia`, and `@sinclair+typebox@0.34.52`
 * is `@sinclair/typebox`. A directory with no `@` after its first character
 * holds no package: the link farm Bun keeps beside them is named
 * `node_modules`, and a scope on its own is named `@types`.
 */
export function packageOf(directory: string): string | undefined {
  const at = directory.lastIndexOf('@');
  if (at <= 0) {
    return undefined;
  }
  return directory.slice(0, at).replace('+', '/');
}

/** What the store of the built image holds, from the lines `ls` printed. */
export function packagesIn(listing: string): string[] {
  const names = new Set<string>();
  for (const line of listing.split('\n')) {
    const name = packageOf(line.trim());
    if (name !== undefined) {
      names.add(name);
    }
  }
  return [...names].sort();
}

/** Where the image and the table disagree. Both lists empty means they agree. */
export type Disagreement = {
  /** In the image, not in the table. A development tool here is a defect. */
  extra: string[];
  /** In the table, not in the image. */
  missing: string[];
};

/** Read the store of an image against the table of what it may hold. */
export function notAllowed(held: readonly string[], allowed: Readonly<Record<string, string>>): Disagreement {
  return {
    extra: held.filter((name) => !(name in allowed)).sort(),
    missing: Object.keys(allowed)
      .filter((name) => !held.includes(name))
      .sort(),
  };
}
