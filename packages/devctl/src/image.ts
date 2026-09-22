import type { Command } from './command.ts';
import { dockerAnswers, dockerDown } from './docker.ts';
import { IMAGE_PACKAGES, notAllowed, packagesIn, STORE } from './image-contents.ts';
import { run } from './proc.ts';
import { head, isClean } from './repo.ts';
import { stream } from './stream.ts';

/** Fly's machines run linux/amd64. The image is built for them, whatever the developer's machine is. */
export const FLY_PLATFORM = 'linux/amd64';

export const image: Command = {
  name: 'image',
  summary: 'Build the production image from the checkout and check what it holds',
  args: '',
  help: `
Build the production image (C7) from the Dockerfile at the root, with the
checkout as its build context, the way a deploy builds it. This is the
image a deploy sends to Fly: there is one image, not two. .dockerignore
lets in the manifests, the lockfile and the packages production runs, so
no file a development tool leaves in the checkout reaches the image, and
no dependency of a package production does not run.

No development tool is in the image. They install and run on a
developer's machine only (\`devlocal\` DL1), so none of them can stop this
build. Stryker stopped eal's, from June to 2026-08-25, and nothing saw it
until a deploy (L6).

After the build, ${STORE} is listed in the image and every package in it
is looked up in IMAGE_PACKAGES, the table in image-contents.ts that says
what put each one there. The command fails on a package the table does
not name, and on a package the table names that the image does not hold.

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
    const listed = await run(['docker', 'run', '--rm', '--platform', FLY_PLATFORM, tag, 'ls', STORE], root);
    if (listed.code !== 0) {
      console.error(`The image ${tag} does not list ${STORE}:\n${listed.output.trim()}`);
      return 1;
    }
    const held = packagesIn(listed.output);
    const { extra, missing } = notAllowed(held, IMAGE_PACKAGES);
    if (extra.length > 0) {
      console.error(`The image holds packages IMAGE_PACKAGES does not name: ${extra.join(', ')}.`);
      console.error('A development tool among them is a defect: keep it out in .dockerignore or in the Dockerfile.');
    }
    if (missing.length > 0) {
      console.error(`IMAGE_PACKAGES names packages the image does not hold: ${missing.join(', ')}.`);
    }
    if (extra.length > 0 || missing.length > 0) {
      return 1;
    }
    console.log(`Built ${tag}, for ${platform}, holding ${held.length} packages and no development tool.`);
    return 0;
  },
};
