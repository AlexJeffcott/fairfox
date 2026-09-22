import type { Command } from './command.ts';
import { dockerAnswers, dockerDown } from './docker.ts';
import { stream } from './stream.ts';

/** The tag of the image CI builds. Nothing is pushed. */
export const IMAGE_TAG = 'fairfox:ci';

export const image: Command = {
  name: 'image',
  summary: 'Build the production image from the checkout',
  args: '',
  help: `
Build the production image (C7) from the Dockerfile at the root, with the
checkout as its build context, the way a deploy builds it. .dockerignore
lets in only the manifests, the lockfile and packages/, so no file a
development tool leaves in the checkout reaches the image.

Every development tool is in package.json and bun.lock, and the production
install reads both. A development tool that stops that install, or any
later step, fails this command: in CI, not at the first deploy after it.

Tags the image ${IMAGE_TAG}. Pushes nothing. Docker must be running.
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
    return stream(['docker', 'build', '--progress', 'plain', '--tag', IMAGE_TAG, '.'], root);
  },
};
