Unit tests:

Setup: 

These can be run individually (at command line), or all of them from the top
level with ''pnpm test''.

There's also a local (static) index.static.html, as well as ''index.html'' (run
with ''./serve.py'') to facilitate debugging at browser IDE command line.

Test suite configuration is in 'config.ts' (which also pulls from '../env.js').

Note for example that you can set debug output level from the jslib libarry in
'config.ts'.


Notes:

* ''deno test'' at the top level is run with ''--no-check'' to get around issues
with parts of web api standards not fully supported by Deno (supported
''indexeddb''), and even with feature detection, there's no nice way (that we
know of) to configure Deno to shut up about _some_ of the TS errors. Since all
the test scripts can be run individually, and we develop in VSCode with TS
linters anyway, not too worried.

* 04.01 requires channel-server to be running. The output from running 04.01 is
the channel handle you copy-paste into ''env.js'' for ''localBudge5tHandle''.

