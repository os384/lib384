#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env

const OS384_PATH = '.';

const DBG0 = true;

import { LocalStorage } from "../tools/LocalStorage.ts";

import { assertEquals, assertExists } from "@std/assert";

// Helper functions
function getDbFiles(dbName: string): string[] {
   return [...Deno.readDirSync(`${OS384_PATH}/db`)]
       .map(f => f.name)
       .filter(name => name.startsWith(dbName))
       .sort();
}

function cleanupTestFiles(dbName: string) {
   try {
       for (const file of getDbFiles(dbName)) {
           Deno.removeSync(`${OS384_PATH}/db/${file}`);
       }
   } catch {
       // Ignore errors
   }
}

export async function test00() {
    const dbName = "test0";
    cleanupTestFiles(dbName);
    console.log(`==== Running ${dbName} ====`);
    
    try {
        // Simulate a crash: create data without flushing
        const storage1 = new LocalStorage(dbName);
        await storage1.setItem("key1", "value1");
        await storage1.setItem("key2", "value2");
        
        // New instance should detect crash and flush immediately
        const storage2 = new LocalStorage(dbName);
        
        // Check that we have exactly one DB file and one journal file
        const files = getDbFiles(dbName);
        const dbFiles = files.filter(f => f.endsWith('.json'));
        const journalFiles = files.filter(f => f.endsWith('.journal.txt'));
        
        if (dbFiles.length !== 1) {
            throw new Error(`Expected exactly one DB file after recovery, found ${dbFiles.length}: ${dbFiles.join(', ')}`);
        }
        if (journalFiles.length !== 1) {
            throw new Error(`Expected exactly one journal file after recovery, found ${journalFiles.length}: ${journalFiles.join(', ')}`);
        }
        
        // And data should be preserved
        const val1 = await storage2.getItem("key1");
        const val2 = await storage2.getItem("key2");
        
        if (val1 !== "value1") {
            throw new Error(`Expected key1 to be "value1", got "${val1}"`);
        }
        if (val2 !== "value2") {
            throw new Error(`Expected key2 to be "value2", got "${val2}"`);
        }
        
        console.log("✓ Crash recovery and immediate flush test passed");
    } finally {
        cleanupTestFiles(dbName);
    }
}

// Individual test functions
export async function test01() {
   const dbName = "test1";
   cleanupTestFiles(dbName);
   console.log(`==== Running ${dbName} ====`);
   
   try {
       const storage = new LocalStorage(dbName);
       
       await storage.setItem("key1", "value1");
       assertEquals(await storage.getItem("key1"), "value1");
       
       await storage.setItem("key1", "value2");
       assertEquals(await storage.getItem("key1"), "value2");
       
       await storage.setItem("key1", undefined);
       assertEquals(await storage.getItem("key1"), undefined);
       
       assertEquals(await storage.getItem("nonexistent"), undefined);
       
       console.log("✓ Basic operations test passed");
   } finally {
       cleanupTestFiles(dbName);
   }
}

export async function test02() {
   const dbName = "test2";
   cleanupTestFiles(dbName);
   console.log(`==== Running ${dbName} ====`);
   
   try {
       const storage1 = new LocalStorage(dbName);
       await storage1.setItem("key1", "value1");
       await storage1.flush();
       
       const storage2 = new LocalStorage(dbName);
       assertEquals(await storage2.getItem("key1"), "value1");
       
       console.log("✓ Persistence across instances test passed");
   } finally {
       cleanupTestFiles(dbName);
   }
}

export async function test03() {
   const dbName = "test3";
   cleanupTestFiles(dbName);
   console.log(`==== Running ${dbName} ====`);

   try {
       const storage1 = new LocalStorage(dbName);
       await storage1.setItem("key1", "value1");
       await storage1.flush();
       
       await storage1.setItem("key2", "value2");
       await storage1.setItem("key3", "value3");
       
       const storage2 = new LocalStorage(dbName);
       assertEquals(await storage2.getItem("key1"), "value1");
       assertEquals(await storage2.getItem("key2"), "value2");
       assertEquals(await storage2.getItem("key3"), "value3");
       
       console.log("✓ Journal recovery test passed");
   } finally {
       cleanupTestFiles(dbName);
   }
}

export async function test04() {
   const dbName = "test4";
   cleanupTestFiles(dbName);
   console.log(`==== Running ${dbName} ====`);

   try {
       const storage = new LocalStorage(dbName);
       
       await storage.setItem("key1", "value1");
       await storage.flush();
       await storage.setItem("key2", "value2");
       await storage.flush();
       await storage.setItem("key3", "value3");
       await storage.flush();
       
       const files = getDbFiles(dbName);
       const jsonFiles = files.filter(f => f.endsWith('.json'));
       assertEquals(jsonFiles.length, 2);
       
       assertExists(files.find(f => f.endsWith('.journal.txt')));
       
       console.log("✓ Version management test passed");
   } finally {
       cleanupTestFiles(dbName);
   }
}

export async function test05() {
   const dbName = "test5";
   cleanupTestFiles(dbName);
   console.log(`==== Running ${dbName} ====`);

   try {
       const storage = new LocalStorage(dbName);
       
       await Promise.all([
           storage.setItem("key1", "value1"),
           storage.setItem("key2", "value2"),
           storage.setItem("key3", "value3"),
       ]);
       
       assertEquals(await storage.getItem("key1"), "value1");
       assertEquals(await storage.getItem("key2"), "value2");
       assertEquals(await storage.getItem("key3"), "value3");
       
       console.log("✓ Concurrent operations test passed");
   } finally {
       cleanupTestFiles(dbName);
   }
}

export async function test06() {
   console.log(`==== Running test06 ====`);

   const invalidNames = ["test-db", "test/db", "test.db", "test db", ""];
   
   for (const name of invalidNames) {
       try {
           new LocalStorage(name);
           throw new Error(`Should have rejected invalid name: ${name}`);
       } catch (e) {
           assertEquals(e.message, "Invalid database name (alphanumeric and '_' only)");
       }
   }
   
   console.log("✓ Invalid database names test passed");
}

export async function test07() {
   const dbName = "test7";
   cleanupTestFiles(dbName);
   console.log(`==== Running ${dbName} ====`);
   
   try {
       const storage = new LocalStorage(dbName);
       
       const complexValue = {
           number: 42,
           string: "test",
           boolean: true,
           array: [1, 2, 3],
           nested: { a: 1, b: 2 },
           null: null
       };
       
       await storage.setItem("complex", complexValue);
       await storage.flush();
       
       const storage2 = new LocalStorage(dbName);
       assertEquals(await storage2.getItem("complex"), complexValue);
       
       console.log("✓ Complex values test passed");
   } finally {
       cleanupTestFiles(dbName);
   }
}

// Deno test registrations
Deno.test("LocalStorage - Crash recovery", test00);
Deno.test("LocalStorage - Basic operations", test01);
Deno.test("LocalStorage - Persistence across instances", test02);
Deno.test("LocalStorage - Journal recovery", test03);
Deno.test("LocalStorage - Version management", test04);
Deno.test("LocalStorage - Concurrent operations", test05);
Deno.test("LocalStorage - Invalid database names", test06);
Deno.test("LocalStorage - Complex values", test07);

export async function stressTest01() {
    const dbName = "stress1";
    cleanupTestFiles(dbName);
    console.log(`==== Running ${dbName} stress test ====`);

    try {
        const storage = new LocalStorage(dbName);
        const iterations = 10000;
        const startTime = Date.now();
        
        // Do rapid-fire updates to same key
        for (let i = 0; i < iterations; i++) {
            await storage.setItem("testKey", `value${i}`);
            if (i % 1000 === 0) {
                await storage.flush();  // Occasional blocking flush
            }
        }
        
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000; // seconds
        const opsPerSecond = Math.round(iterations / duration);
        
        console.log(`Completed ${iterations} operations in ${duration.toFixed(2)} seconds`);
        console.log(`Performance: ${opsPerSecond} operations/second`);
        
        // Verify final state
        const finalValue = await storage.getItem("testKey");
        if (finalValue !== `value${iterations-1}`) {
            throw new Error(`Data integrity check failed. Expected "value${iterations-1}", got "${finalValue}"`);
        }
    } finally {
        cleanupTestFiles(dbName);
    }
}

// Interactive test runner
if (import.meta.main) {
    console.log("Running tests interactively...\n");
    await test00();
    await test01();
    await test02();
    await test03();
    await test04();
    await test05();
    await test06();
    await test07();
    console.log("\nAll tests completed successfully!");
    console.log("\nRunning stress test...");
    await stressTest01();
    console.log("Stress test completed successfully!");
}
