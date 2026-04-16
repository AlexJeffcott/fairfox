// Signaling server setup for fairfox — mounts the polly signaling
// WebSocket endpoint on an Elysia app so that mesh peers can discover
// each other and exchange WebRTC SDP/ICE candidates. The signaling
// server is stateless (it relays messages between peers but does not
// store or inspect them) and is the only server-side module that
// sub-apps need for the mesh transport. See ADR 0001 and ADR 0002.

import { signalingServer } from '@fairfox/polly/elysia';

export const SIGNALING_PATH = '/polly/signaling';

export const fairfoxSignaling = signalingServer({ path: SIGNALING_PATH });
