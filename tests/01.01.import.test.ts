
// actually we don't run this test anymore: our unit tests work directly against
// typescript and not the assembled 384 library. for the latter case, we run
// in-browser test suites.


// #!/usr/bin/env -S deno run --allow-read

// import * as __ from "../dist/384.esm.js"

// Deno.test("[fast] Test module (top level static) import of library", async () => {
//     console.log('\n===================== 01.01 START import.test =====================')
//     console.log("This should show version:", __.version);
//     console.log('===================== 01.01 END import.test =====================')
// });
