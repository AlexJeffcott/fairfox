# Product vision

What fairfox is supposed to feel like to use, expressed as user stories.
Behaviours, not architecture. If a sentence here can only be read by
someone who already knows how the system is built, it has drifted and
should be rewritten.

## Continuity across devices

- As a user, I want to open any of my paired devices and see what my partner edited five minutes ago, with no refresh button to press.
- As a user, I want to start a list on my phone on the train and finish it on my laptop at home, without thinking about which device wrote what.

## Sharing with the people I live with

- As a user, I want to add a chore on my phone and have my partner see it before they finish their coffee.

## Privacy as a property of the things I write

- As a user, I want anything I write inside fairfox to be markable as "for me only" or "for me and people I name", and to feel completely confident that the system enforces that — my son, the discovery server's operator, and anyone else outside the named circle simply cannot read it.

## Setting it up

- As a creator, I want to start a brand-new fairfox household in one short ceremony — pick a name, become its admin, done — without a multi-step server-config quest.
- As a creator, I want to invite the people I live with at the same moment I set the household up, so they can join from their own device without me orchestrating anything else.
- As a creator, I want to be able to abandon a fairfox household I was just trying out and start fresh, without leaving residue, paying for anything, or revoking accounts I created elsewhere.

## Adding people and devices

- As a user, I want to add a new phone to my own setup and from then on have it be "one of mine" — same data, same identity.
- As an admin, I want to invite my kid as a guest who can see the family agenda but can't edit grandma's number or read my journal.

## Working with an assistant

- As a user, I want to ask an assistant to plan tomorrow's chores, and watch it write into the same agenda I'd write into — under my permissions, not as a separate "AI workspace" I'd have to copy things back from.

## Resilience and ownership

- As a user, I want my devices to keep doing everything except exchange with other devices when they can't reach each other — write, edit, search, browse my own copy — and to catch up with everyone else automatically once contact resumes.
- As a user, I want my data to be unreadable by anyone I haven't paired in — including whoever runs the discovery server.
- As a user, I want to be able to walk away with everything I've written, in a plain file I can open in a text editor, without asking permission.

## Equal access surfaces

- As a user, I want to do every read and write from a terminal that I can do in the browser, so I can script my routines instead of clicking through a UI.

## Self-contained

- As a user, I want to create a fresh instance of fairfox without needing new infrastructure — no new server to provision, no new database, no new cloud account to set up.
- As a user, I want to use fairfox without signing up for outside services or platforms — no third-party accounts, no API keys to register, no "this feature requires you to also have an account at X" flow.
