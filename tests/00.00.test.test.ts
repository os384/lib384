#!/usr/bin/env -S deno run

// does nothing. sanity check of deno tests.

Deno.test("[fast] testing the tester", async () => {
  console.log('\n===================== 00.00 START test =====================')
  console.log(4 * 12 * 10)
  console.log('===================== 00.00 END tests =====================')
});

