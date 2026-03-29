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
/**
 * Implements event handling interface, compatible with EventTarget but also
 * supports 'on', 'off', and 'emit'. Note: entirely 'static', so any class
 * that extends this will implement a global event handler for that class.
 */
export class SBEventTarget {
    private static listeners: { [type: string]: ((event: Event | any) => void)[] } = {};

    static addEventListener(type: string, callback: (event: Event) => void, _options?: boolean | AddEventListenerOptions): void {
        SBEventTarget.listeners[type] = SBEventTarget.listeners[type] || [];
        SBEventTarget.listeners[type].push(callback);
    }

    static removeEventListener(type: string, callback: (event: Event) => void, _options?: boolean | EventListenerOptions): void {
        if (!SBEventTarget.listeners[type]) return;
        const stack = SBEventTarget.listeners[type];
        const index = stack.indexOf(callback);
        if (index > -1) {
            stack.splice(index, 1);
        }
    }

    static dispatchEvent(event: Event): boolean {
        const listeners = SBEventTarget.listeners[event.type];
        if (!listeners) return true;
        listeners.forEach(listener => listener(event));
        return !event.defaultPrevented;
    }

    static on(eventName: string, listener: (args: any) => void) {
        SBEventTarget.addEventListener(eventName, listener as any);
    }

    static off(eventName: string, listener: (args: any) => void) {
        SBEventTarget.removeEventListener(eventName, listener as any);
    }

    static emit(eventName: string, ...args: any[]) {
        const event = new CustomEvent(eventName, { detail: args.length === 1 ? args[0] : args });
        SBEventTarget.dispatchEvent(event);
    }
}
