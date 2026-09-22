import type { Command } from './command.ts';
import { dockerAnswers, dockerDown } from './docker.ts';
import { run } from './proc.ts';
import { head, isClean } from './repo.ts';
import { stream } from './stream.ts';

/** Fly's machines run linux/amd64. The image is built for them, whatever the developer's machine is. */
export const FLY_PLATFORM = 'linux/amd64';

export const image: Command = {
  name: 'image',
  summary: 'Build the production image from the checkout',
  args: '',
  help: `
Build the production image (C7) from the Dockerfile at the root, with the
checkout as its build context, the way a deploy builds it. .dockerignore
lets in only the manifests, the lockfile and packages/, so no file a
development tool leaves in the checkout reaches the image.

The image has every development tool installed: its install is the full
one, from package.json and bun.lock. It runs on Node 24 with Bun 1.4.2. A
development tool that stops that install, or any later step, fails this
command: in CI, not at the first deploy after it.

It is built for ${FLY_PLATFORM}, the platform of Fly's machines, under
emulation on an arm64 machine, and fails when the image is for another.
It is tagged fairfox:<commit>, or fairfox:<commit>-dirty when the working
tree has changes, so no two checkouts share a tag. Pushes nothing. Docker
must be running.
`,
  flags: [],
  run: async ({ root, positionals }) => {
    if (positionals.length > 0) {
      console.error('devctl image takes no arguments');
      return 1;
    }
    if (!(await dockerAnswers(root))) {
      console.error(dockerDown('image'));
      return 1;
    }
    const tag = `fairfox:${await head(root)}${(await isClean(root)) ? '' : '-dirty'}`;
    const built = await stream(
      ['docker', 'build', '--progress', 'plain', '--platform', FLY_PLATFORM, '--tag', tag, '.'],
      root,
    );
    if (built !== 0) {
      return built;
    }
    const inspected = await run(['docker', 'image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', tag], root);
    const platform = inspected.output.trim();
    if (platform !== FLY_PLATFORM) {
      console.error(`The image ${tag} is for ${platform}, and Fly's machines run ${FLY_PLATFORM}.`);
      return 1;
    }
    console.log(`Built ${tag}, for ${platform}.`);
    return 0;
  },
};
