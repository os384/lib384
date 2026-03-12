// (c) 2024 384 (tm)

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
