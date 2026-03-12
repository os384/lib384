#!/usr/bin/env -S deno run --allow-read

export class CommunicationChannel {
    #ready: Promise<CommunicationChannel>;
    #rejectError?: (error: Error) => void;
    #errorPromise?: Promise<CommunicationChannel>;

    // this can be called multiple times
    #readyFactory (): Promise<CommunicationChannel> {
        console.log("Calling ready factory")
        this.#errorPromise = new Promise<CommunicationChannel>((_, reject) => {
            console.log("Inside errorPromise setup")
            this.#rejectError = reject;
            console.log(reject)
        });
        return Promise.race([
            this.#errorPromise,
            new Promise<CommunicationChannel>((resolve, _) => {
                // we simulate 'throwing' a problem in two seconds
                setTimeout(() => {
                    this.#rejectError!(new Error('Simulated error'));
                }, 2000);
                // and pretend that at the start, all is well
                resolve(this)
            })
        ]);
    };

    constructor() {
        this.#ready = this.#readyFactory();
    }

    get errorPromise() {
        // note, this will never be undefined
        return this.#errorPromise;
    }

    get ready() { return this.#ready; }

    reset() {
        this.#ready = this.#readyFactory();
    }
}

async function test01() {
    // sample usage
    const newChannel = new CommunicationChannel();

    // we should be able to do this right away
    console.log(newChannel)
    if (!newChannel.errorPromise)
        throw new Error("errorPromise should be defined");
    newChannel.errorPromise.catch(error => {
        console.error('Operational error:', error.message);
    });

    await newChannel.ready;
    console.log("Channel is 'ready', returning from test01");
}

// currently this leaves dangling timers, but we're not worried about that,
// this is used to demonstrate/test the 'observer' pattern
// Deno.test("[02.10] [fast] Observer Pattern Test", async () => {
//     await test01();
// });

if (import.meta.main) {
    await test01();
}
