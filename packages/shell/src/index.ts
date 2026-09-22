// The shell: the first unit of the UI (A2, step 7b). At step 0a it has no
// sign-in, no unit and no data. It draws the name, with Preact, Signals and
// polly, into the empty body of index.html: with scripts turned off the page
// shows no name.
import { $state } from '@fairfox/polly/state';
import { h, render } from 'preact';

const name = $state('Fairfox');

render(h('h1', null, name), document.body);
