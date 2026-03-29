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