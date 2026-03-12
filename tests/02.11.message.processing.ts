#!/usr/bin/env -S deno run

// Lazy async iterable example, basis for new message processing pipeline;
// simple example of composing async iterables with functional programming

const SEP = '='.repeat(76) + '\n';

interface Message {
    timestamp: number;
    content: string;
}

interface MessageStreamOptions {
    start?: number;
    end?: number;
    live?: boolean;
    count?: number; // Limit the number of messages to process
}

// const messages: Message[] = [
//     { timestamp: 1, content: "Message 1" },
// ];
// for (let i = 2; i <= 20; i++) {
//     messages.push({ timestamp: i, content: `Message ${i}` });
// }

// Generic lazy async iterable class
class LazyAsyncStream<T> implements AsyncIterable<T> {
    constructor(private source: AsyncIterable<T>) { }

    map<U>(fn: (value: T) => U | Promise<U>): LazyAsyncStream<U> {
        const source = this.source;
        const mapped = async function* () {
            for await (const item of source) {
                yield await fn(item);
            }
        };
        return new LazyAsyncStream(mapped());
    }

    filter(predicate: (value: T) => boolean | Promise<boolean>): LazyAsyncStream<T> {
        const source = this.source;
        const filtered = async function* () {
            for await (const item of source) {
                if (await predicate(item)) {
                    yield item;
                }
            }
        };
        return new LazyAsyncStream(filtered());
    }

    async reduce<U>(
        fn: (accumulator: U, value: T) => U | Promise<U>,
        initialValue: U
    ): Promise<U> {
        let acc = initialValue;
        for await (const item of this.source) {
            acc = await fn(acc, item);
        }
        return acc;
    }

    take(maxCount: number = Infinity): LazyAsyncStream<T> {
        const source = this.source;
        const taken = async function* () {
            let count = 0;
            for await (const item of source) {
                if (count >= maxCount) return;
                yield item;
                count++;
            }
        };
        return new LazyAsyncStream(taken());
    }

    async toArray(): Promise<T[]> {
        const result: T[] = [];
        for await (const item of this.source) {
            result.push(item);
        }
        return result;
    }

    // Implementing [Symbol.asyncIterator]() to make the class an async iterable
    [Symbol.asyncIterator](): AsyncIterator<T> {
        return this.source[Symbol.asyncIterator]();
    }
}


// Lazy generator to produce messages based on given options
async function* messageStream(
    options: MessageStreamOptions
): AsyncIterable<Message> {
    const { start = 0, end = Infinity } = options;
    const forward = end >= start;

    const filteredMessages = messages.filter(
        (msg) => {
            if (forward) {
                return (msg.timestamp >= start) && (msg.timestamp <= end);
            } else {
                return (msg.timestamp <= start) && (msg.timestamp >= end);
            }
        }
    );

    const sortedMessages = forward
        ? filteredMessages.sort((a, b) => a.timestamp - b.timestamp)
        : filteredMessages.sort((a, b) => b.timestamp - a.timestamp);

    console.log(SEP, "Filtered and sorted messages:", sortedMessages);

    for (const message of sortedMessages)
        yield message;

    if (forward && options.live) {
        while (true) {
            const liveMessage = await waitForNewMessage(); // Simulate new incoming message
            yield liveMessage;
        }
    }
}


// Simulated function to fetch new live messages
async function waitForNewMessage(): Promise<Message> {
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate delay
    const newMessage = {
        timestamp: Date.now(),
        content: `Live message at ${Date.now()}`,
    };
    messages.push(newMessage); // Add to the global message list
    return newMessage;
}

// Usage example with functional composition
async function runTest(options: MessageStreamOptions): Promise<void> {
    console.log(SEP, "Running test ..."); console.log(SEP);

    const messageGen = new LazyAsyncStream(messageStream(options))
        // example of a processing pipeline, first a transformation
        .map(async (msg) => ({
            ...msg,
            content: `Processed: ${msg.content}`,
        }))
        // then a filter
        .filter(async (msg) => msg.timestamp > 0)
        // // then a logger that does not change the message
        // .map(async (msg) => {
        //     console.log("... streaming processing of message:", msg);
        //     return msg;
        // })
        // then a 'guard' to limit the number of messages (which might be 'infinte')
        .take(options.count); // limit

    // now let's consume this iterator, but, we will only print out the first three, then stop (finish the stream)
    console.log(SEP, "Consuming the message stream, with early exit:");
    let count = 0;
    for await (const m of messageGen) {
        console.log("Consumed message:", m);
        count++;
        if (count >= 3) break;
    }


    // // To array to visualize processed results
    // const result = await messageGen.toArray();
    // console.log(SEP, "Result of getting it as an array:\n", result);

    // // If we wanted to reduce, we could do:
    // const reducedResult = await messageGen.reduce(
    //     async (acc, msg) => acc + msg.timestamp,
    //     0
    // );
    // console.log(SEP, `Reduced result (sum of timestamps): ${reducedResult}`);
}

function main() {
    let options: MessageStreamOptions = {}

    // test 1
    options = {
        start: 18,
        count: 5,
        live: true,
    };
    console.log(SEP, "Test 1:", options);
    runTest(options);

    // test 2
    options = {
        start: 20,
        end: 12,
    };
    console.log(SEP, "Test 2:", options);
    runTest(options);
}

main();
