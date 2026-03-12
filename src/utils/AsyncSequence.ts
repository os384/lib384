// (c) 2024 384 (tm)

/**
 * (c) 2024 384 (tm)
 *
 * AsyncSequence implements general operations on an async sequence of items.
 *
 * Transformations:
 * - map()       : projects each element to another value
 * - flatMap()   : projects each element to another sequence, then flattens
 *
 * Filtering:
 * - filter()    : filters elements based on a predicate, keeping only those
 *                 that evaluate to 'true'
 *
 * Truncation and Limits:
 * - take()        : limits the sequence to the first 'n' elements
 * - takeWhile()   : limits the sequence as long as a predicate is true
 * - limitUntil()  : similar to 'takeWhile()', but in reverse logic
 * - skip()        : skips the first 'n' elements, emitting the rest
 * - skipWhile()   : skips elements as long as a predicate is true
 * - skipUntil()   : similar to 'skipWhile()', but in reverse logic
 *
 * Combining, Merging, Splitting:
 * - concat()      : concatenates two sequences into one, starting the second
 *   when the first is done
 * - merge()       : merges two sequences into one, emitting as soon as any of
 *   the sources emits
 * - zip()         : combines two sequences into a single sequence of pairs
 *
 * Consumers / Aggregators:
 * - reduce()      : reduces the sequence to a single value
 * - toArray()     : collects all elements in the sequence into an array
 * - find()        : finds the first element that matches a predicate
 * - any()         : checks if any element in the sequence matches a predicate
 * - some()        : alias for 'any()'
 * - every()       : checks if all elements in the sequence match a predicate
 * - none()        : checks if no elements in the sequence match a predicate
 * - count()       : counts the number of elements in the sequence
 * - first()       : returns the first element of the sequence
 * - last()        : returns the last element of the sequence
 *
 */
export class AsyncSequence<T> implements AsyncIterable<T> {

    /**
     * Generally available to any subclasses to coordinate
     * 'remainders' from any (optimized) skip operations.
     */
    residualSkipValue = 0;

    /**
     * Providing source on creation is optional, and it
     * can be changed dynamically.
     */
    constructor(private _source?: AsyncIterable<T>) { }

    set source(value) { this._source = value; }
    get source() {
        if (!this._source) throw new Error("No source for the sequence");
        return this._source;
    }

    get residualSkip(): number {
        return this.residualSkipValue;
    }
    set residualSkip(value: number) {
        this.residualSkipValue = value;
    }

    // Transformations

    /**
     * Projects each element of the sequence to another value.
     */
    map<U>(fn: (value: T) => U | Promise<U>): AsyncSequence<U> {
        const source = this.source;
        const mapped = async function* () {
            for await (const item of source)
                yield await fn(item);
        };
        return new AsyncSequence(mapped());
    }

    /** Concatenates (or 'flatens') the sequence, enforces serialization */
    concatMap<U>(fn: (value: T) => Iterable<U> | AsyncIterable<U>): AsyncSequence<U> {
        const source = this.source;
        const flatMapped = async function* () {
            for await (const item of source) {
                const mapped = fn(item);
                if (!mapped) continue;
                if (typeof (mapped as AsyncIterable<U>)[Symbol.asyncIterator] === 'function') {
                    for await (const subItem of mapped as AsyncIterable<U>) yield subItem;
                } else if (typeof (mapped as Iterable<U>)[Symbol.iterator] === 'function') {
                    for (const subItem of mapped as Iterable<U>) yield subItem;
                } else {
                    throw new Error("The function provided to flatMap must return an Iterable or AsyncIterable");
                }
            }
        };
        return new AsyncSequence(flatMapped());
    }

    /** Concatenates (or 'flatens') the sequence. Unless overriden, will enforce serialization. */
    flatMap<U>(fn: (value: T) => Iterable<U> | AsyncIterable<U>): AsyncSequence<U> {
        // override this if you want 'flatMap()' to allow concurrent processing
        return this.concatMap(fn);
    }

    /** Same as concatMap() but allows asynchronicity/parallelism. Note implemented in base class. */
    mergeMap<U>(_fn: (value: T) => Iterable<U> | AsyncIterable<U>): AsyncSequence<U> {
        // for convenience, you can use this to make sure that there is a concurrent
        // version that's used (eg you need to implement both 'flatMap()' and then
        // 'mergeMap()' as an alias)
        throw new Error("'mergeMap()' has not been overriden from base, and base flatMap() does not support concurrency.");
    }

    // Filtering

    filter(predicate: (value: T) => boolean | Promise<boolean>): AsyncSequence<T> {
        const source = this.source;
        const filtered = async function* () {
            for await (const item of source) {
                if (await predicate(item))
                    yield item;
            }
        };
        return new AsyncSequence(filtered());
    }


    // Truncation and Limits

    /**
     * Yields elements as long as the predicate is true, and then stops.
     * Equivalent to 'limitUntil()' with the predicate negated.
     */
    takeWhile(predicate: (value: T) => boolean | Promise<boolean>): AsyncSequence<T> {
        const source = this.source;
        const taken = async function* () {
            for await (const item of source) {
                if (!(await predicate(item))) return;
                yield item;
            }
        };
        return new AsyncSequence(taken());
    }

    /** Limits the sequence to the first 'count' elements */
    take(count: number): AsyncSequence<T> {
        const source = this.source;
        const taken = async function* () {
            let takenCount = 0;
            for await (const item of source) {
                if (takenCount >= count) return;
                yield item;
                takenCount++;
            }
        };
        return new AsyncSequence(taken());
    }

    /**
     * Skips elements as long as predicate is true, and then emits the first
     * element for which the predicate is false and all subsequent elements. If
     * the predicate is false for the first element, the entire sequence will be
     * emitted. If the predicate never evaluates to false, the resulting
     * sequence will be empty. Equivalent to 'skipUntil()' with the predicate
     * negated.
     */
    skipWhile(predicate: (value: T) => boolean | Promise<boolean>): AsyncSequence<T> {
        const source = this.source;
        const skipped = async function* () {
            let skipping = true;
            for await (const item of source) {
                if (skipping && !(await predicate(item))) skipping = false;
                if (!skipping) yield item;
            }
        };
        return new AsyncSequence(skipped());
    }

    /**
     * Skips elements as long as the predicate is false. The first element for
     * which the predicate is true will be emitted and the sequence will
     * continue from there. If the predicate is true for the first element,
     * the entire sequence will be emitted. If the predicate never evaluates
     * to true, the resulting sequence will be empty. Equivalent to 'skipWhile()'
     * with the predicate negated.
    */
    skipUntil(predicate: (value: T) => boolean | Promise<boolean>): AsyncSequence<T> {
        return this.skipWhile(async (value) => !(await predicate(value)));
    }

    /** Skips the first 'count' elements */
    skip(count: number): AsyncSequence<T> {
        return this.skipWhile(async () => count-- > 0);
    }

    /**
     * All elements will be emitted until the predicate evaluates to true, at
     * which point the sequence will stop. If the predicate is true for the
     * first element, the resulting sequence will be empty. This is the same
     * as 'takeWhile()' with the predicate negated.
     */
    limitUntil(predicate: (value: T) => boolean | Promise<boolean>): AsyncSequence<T> {
        return this.takeWhile(async (value) => !(await predicate(value)));
    }


    // Combining, Merging, Splitting

    /**
     * Concatenates two sequences into one, starting the second when the first
     * is done. Note if you have derived classes with optimizations for any
     * of the AsyncSequence methods, eg a smarter 'skip()', then those
     * will be ignored when using 'concat()' (eg you would need to override
     * 'concat()' to make sure that the optimizations are applied).
     */
    concat(other: AsyncSequence<T>) {
        const myThis = this;
        const concatted = async function* () {
            yield* myThis.source;
            yield* other.source;
        };
        return new AsyncSequence(concatted());
    }

    /**
     * Merge() - merges two sequences into one, emitting as soon as any of the sources emits
     */
    merge(other: AsyncSequence<T>): AsyncSequence<T> {
        const source = this.source;
        const merged = async function* () {
            const iterators = [source[Symbol.asyncIterator](), other[Symbol.asyncIterator]()];
            const results = iterators.map((it) => it.next());

            while (results.length > 0) {
                try {
                    const { value, done } = await Promise.race(results);
                    const index = results.findIndex(p => p === Promise.resolve({ value, done }));
                    if (done) {
                        // Remove the iterator that's done
                        iterators.splice(index, 1);
                        results.splice(index, 1);
                    } else {
                        yield value;
                        // Replace the resolved promise with the next one
                        results[index] = iterators[index].next();
                    }
                } catch (err) {
                    throw err;
                }
            }
        };
        return new AsyncSequence(merged());
    }


    /**
     * Combines two sequences into a single sequence of pairs
     */
    zip<U>(other: AsyncSequence<U>): AsyncSequence<[T, U]> {
        const source = this.source;
        const zipped = async function* () {
            const sourceIterator = source[Symbol.asyncIterator]();
            const otherIterator = other[Symbol.asyncIterator]();
            while (true) {
                const sourceResult = await sourceIterator.next();
                const otherResult = await otherIterator.next();
                if (sourceResult.done || otherResult.done) break;
                yield [sourceResult.value, otherResult.value] as [T, U];
            }
        }
        return new AsyncSequence(zipped());
    }

    // Consuming / Aggregating / Seeking

    /** Consumes and executes given predicate for each element */
    async forEach(fn: (value: T) => void | Promise<void>): Promise<void> {
        for await (const item of this.source)
            await fn(item);
    }

    /** Applies a function against an accumulator and each element in the sequence */
    async reduce<U>(
        fn: (accumulator: U, value: T) => U | Promise<U>,
        initialValue: U
    ): Promise<U> {
        let acc = initialValue;
        for await (const item of this.source)
            acc = await fn(acc, item);
        return acc;
    }

    async toArray(): Promise<T[]> {
        const result: T[] = [];
        for await (const item of this.source)
            result.push(item);
        return result;
    }

    /** Returns true if the predicate evaluates to true for ANY element */
    async any(predicate: (value: T) => boolean | Promise<boolean>): Promise<boolean> {
        for await (const item of this.source)
            if (await predicate(item)) return true;
        return false;
    }

    /** 'some()' is alias for 'any()' */
    async some(predicate: (value: T) => boolean | Promise<boolean>): Promise<boolean> {
        return this.any(predicate);
    }

    /** Returns true if the predicate evaluates to true for EVERY element */
    async every(predicate: (value: T) => boolean | Promise<boolean>): Promise<boolean> {
        for await (const item of this.source)
            if (!await predicate(item)) return false;
        return true;
    }

    /** Inverse of 'any()', evaluates to true if there is no element for which
     * the predicate evaluates to true */
    async none(predicate: (value: T) => boolean | Promise<boolean>): Promise<boolean> {
        return !(await this.any(predicate));
    }

    /** Returns the first element for which the predicate evaluates to true */
    async find(predicate: (value: T) => boolean | Promise<boolean>): Promise<T | undefined> {
        for await (const item of this.source)
            if (await predicate(item)) return item;
        return undefined;
    }

    /** Return the first element of the sequence */
    async first(): Promise<T | undefined> {
        return (await this.take(1).toArray())[0];
    }

    /** Returns the last element of the sequence */
    async last(): Promise<T | undefined> {
        let last: T | undefined = undefined;
        for await (const item of this.source)
            last = item;
        return last;
    }

    /** Returns the number of elements in the sequence */
    async count(): Promise<number> {
        let count = 0;
        for await (const _ of this.source) count++;
        return count;
    }

    /**
     * Given an index 'N', returns the Nth element of the sequence.
     */
    async elementAt(index: number): Promise<T | undefined> {
        return this.skip(index).first();
    }

    [Symbol.asyncIterator](): AsyncIterator<T> {
        return this.source[Symbol.asyncIterator]();
    }
}
