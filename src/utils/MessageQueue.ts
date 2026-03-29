/*
 * Copyright (C) 2019-2021 Magnusson Institute
 * Copyright (C) 2022-2026 384, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */
const DBG0 = false
//

import { SBError, SEP } from '../common'

/** @internal */
export class MessageQueue<T> {
    private queue: T[] = [];
    private resolve: ((value: T | PromiseLike<T> | null) => void) | null = null;
    private reject: ((reason?: any) => void) | null = null;
    private closed = false;
    private error: any = null;
    enqueue(item: T) {
      if (DBG0) console.log(`[MessageQueue] Enqueueing. There were ${this.queue.length} messages in queue`)
      if (this.closed) throw new SBError('[MessageQueue] Error, trying to enqueue to closed queue');
      if (this.resolve) {
        if (this.queue.length > 0) throw new SBError('[MessageQueue] Error, queue should be empty when resolve is set');
        this.resolve(item);
        this.resolve = null;
        this.reject = null;
      } else {
        this.queue.push(item);
      }
    }
    async dequeue(): Promise<T | null> {
      if (DBG0) console.log(`[MessageQueue] Dequeueing. There are ${this.queue.length} messages left`)
      if (this.queue.length > 0) {
        const item = this.queue.shift()!;
        if (this.closed)
          return Promise.reject(item);
        else {
          if (DBG0) console.log(SEP, SEP, SEP, `[MessageQueue] Dequeueing. Returning item.\n`, item, SEP)
          return Promise.resolve(item);
        }
      } else {
        // if we know nothing more is coming, we can close shop
        if (this.closed)
          return null
        // otherwise, we maintain a promise until we get more data
        return new Promise((resolve, reject) => {
          this.resolve = resolve;
          this.reject = reject;
        });
      }
    }
    isEmpty() {
      return this.queue.length === 0;
    }

    // 'close' will stop queue from accepting more data
    close(reason = 'close') {
      if (DBG0) console.log(`[MessageQueue] Closing. There are ${this.queue.length} messages left. Close reason: ${reason}`)
      this.closed = true;
      this.error = reason;
      if (this.reject) this.reject(this.error); // if anything was waiting, we reject it and close out
    }

    // wait for queue to drain
    async drain(reason?: string) {
      if (DBG0) console.log(`[MessageQueue] Draining.`)
      if (!this.closed) this.close(reason || 'drain')
      while (this.queue.length > 0) {
        if (DBG0) console.log(`[MessageQueue] Draining. There are ${this.queue.length} messages left.`)
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }
  
  