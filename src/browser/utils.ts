// (c) 2024 384 (tm)

export async function clearBrowserState() {
    try {
        // Unregister all service workers
        const registrations = await navigator.serviceWorker?.getRegistrations() || [];
        await Promise.all(registrations.map(reg => reg.unregister()));

        // Clear localStorage, sessionStorage, and cookies
        localStorage.clear();
        sessionStorage.clear();

        // ToDo: cookies can 'hide', unclear how to delete them all, or if that's even a problem
        document.cookie.split(";").forEach(c => {
            document.cookie = c.trim().split("=")[0] + '=;expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/';
        });

        // Delete all IndexedDB databases
        const dbs = await indexedDB.databases();
        await Promise.all(dbs.map(db => { if (db.name) indexedDB.deleteDatabase(db.name) }));

        // Clear all caches
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));

        console.info('... done.');
    } catch (error) {
        console.error('Error clearing something:', error);
    }
}