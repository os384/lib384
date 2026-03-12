// (c) 2023-2024 384 (tm)

import { ObjectHandle } from 'src/storage/ObjectHandle'

import { loadShard } from "./loadShard"
import { getDomainDetails } from "./tld"

const SKIP_OBSERVE = false; // for testing, disables '1', default false
const SKIP_SCAN = false;    // for testing, disables '2', default false

// ToDo: these might be config options upon creating the loader loader,
// otherwise we risk committing versions that are too lenient
// console.log("==== BootstrapLoader: countermeasures enabled:")
if (SKIP_OBSERVE) console.warn("==== BootstrapLoader: 1. MutationObserver disabled (make sure this is not production)")
if (SKIP_SCAN) console.warn("==== BootstrapLoader: 2. Immediate and repeated scans disabled (make sure this is not production)")

/** @internal */
export class bootstrapLoaderClass {
    DBG: boolean        // enable for detailed countermeasure logging

    baseDomain: string        // the base domain of where we are being served from
    subdomain: string | null  // the subdomain of the app (if any)
    port: string              // the port of the app

    // "we" are the loader loader; here is current loader:
    loaderShard: ObjectHandle;

    reportScans = 0; // don't report for ever

    // we try to make sure that we ourselves aren't blocked
    securedTimeout = globalThis.setTimeout.bind(globalThis);

    disconnectObserver: () => void;

    tagScan = () => {
        if (SKIP_SCAN) return;
        const scriptTags = document.querySelectorAll("script");
        for (let i = 0; i < scriptTags.length; i++) {
            if (scriptTags[i].src) {
                if (scriptTags[i].src.startsWith('blob:')) {
                    if (this.DBG) console.log(`==== BootstrapLoader (immediate scan): Allowing (blob) script tag: ${scriptTags[i].src}`);
                } else {
                    const url = new URL(scriptTags[i].src);
                    // if any reason for problem parsing url, we strip it
                    if (!url) {
                        console.warn(`==== BootstrapLoader (immediate scan): Removing external script tag (failed to parse it). Tried sourcing: ${scriptTags[i].src}`);
                        scriptTags[i].remove;
                    } else {
                        // if it has same base domain, we allow it
                        const { baseDomain } = getDomainDetails();
                        if (baseDomain === this.baseDomain) {
                            if (this.DBG) console.log(`==== BootstrapLoader (immediate scan): Allowing (hosted) script tag: ${scriptTags[i].src}`);
                        } else {
                            console.warn(`==== BootstrapLoader (immediate scan): Removing external script tag. Tried sourcing: ${scriptTags[i].src}`);
                            scriptTags[i].remove;
                        }
                    }
                }
            }
        }
    }

    timedScan = () => {
        this.tagScan();
        queueMicrotask(() => this.tagScan());
        this.reportScans++;
        if (this.reportScans < 10) // first second, frequent
            this.securedTimeout(this.timedScan, 100);
        else if (this.reportScans < 20) // next 10 seconds, less frequent
            this.securedTimeout(this.timedScan, 1000);
        else if (this.DBG)
            console.log('==== BootstrapLoader (scan): Stopping regular scans for external script tags.')
    }

    removeExternalScripts = () => {
        this.securedTimeout(this.timedScan, 0); // first check soon

        if (SKIP_OBSERVE) return () => { };
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeName === 'SCRIPT' && node instanceof HTMLScriptElement) {
                            if (node.src) {
                                console.warn(`==== BootstrapLoader (MutationObserver): Removing external script tag. Tried sourcing: ${node.src}`);
                                // we need to destroy the node to have a chance of stopping it from being executed
                                // modifying it (eg modifying "src") will not necessarily work
                                node.remove();
                                // leave breadcrumbs, and play interference
                                const newScript = document.createElement('script');
                                newScript.setAttribute("sb384counterMeasure", "blocked");
                                // this next line supposedly has error
                                // TS2488: Type 'NamedNodeMap' must have a '[Symbol.iterator]()' method that returns an iterator.
                                // but ... i don't think so?  overriding for now.  ToDo.
                                // @ts-ignore
                                for (const attr of node.attributes) {
                                    if (attr.name !== 'src') {
                                        newScript.setAttribute(attr.name, attr.value);
                                    }
                                }
                                mutation.target.appendChild(newScript);
                            } else if (this.DBG) {
                                console.log(`==== BootstrapLoader (MutationObserver): Allowing script tag: ${node.innerHTML.slice(0, 300)}...`);
                            }
                        }
                    });
                }
            });
        });

        // Start observing the body for changes
        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        // Return a function to disconnect the observer
        return () => observer.disconnect();
    }

    // the third and last line of defense is "monkey patched scorched earth":
    // we know the code in this loader loader employs no timers or event 
    // listeners, so we block anything like that. this does not catch
    // everything, there are obscure corners like performance monitors
    // and web sockets that we don't look for (yet).
    scorchedEarth = () => {
        if (this.DBG) console.log("==== BootstrapLoader: SCORCHED EARTH")
        class LogAttemptMutationObserver implements MutationObserver {
            observe(_target: Node, _options?: MutationObserverInit): void {
                logAttempt("MutationObserver");
            }
            disconnect(): void { }
            takeRecords(): MutationRecord[] {
                return [];
            }
        }
        const originals = {
            addEventListener: globalThis.addEventListener.bind(globalThis),
            setTimeout: globalThis.setTimeout.bind(globalThis),
            setInterval: globalThis.setInterval.bind(globalThis),
            MutationObserver: globalThis.MutationObserver,
            dispatchEvent: globalThis.dispatchEvent.bind(globalThis)
        };
        const logAttempt = (methodName: string) => {
            console.warn(`==== BootstrapLoader: Attempted to use "${methodName}" during scorched earth period (blocked).`);
            return -1;
        };
        globalThis.addEventListener = () => logAttempt('addEventListener');
        (globalThis.setTimeout as any) = () => logAttempt('setTimeout');
        (globalThis.setInterval as any) = () => logAttempt('setInterval');
        globalThis.MutationObserver = LogAttemptMutationObserver;
        globalThis.dispatchEvent = function (event: Event) {
            logAttempt('dispatchEvent');
            console.log(event);
            return true; // faking it
        };
        // restoring is done as close as possible to activating the loader
        let restoreWebApi = () => {
            // setting things back in place.  an alternative design is
            // to have a "hand off" to the loader itself
            this.tagScan(); // last chance, heh
            globalThis.addEventListener = originals.addEventListener;
            globalThis.setTimeout = originals.setTimeout;
            globalThis.setInterval = originals.setInterval;
            globalThis.dispatchEvent = originals.dispatchEvent;
            globalThis.MutationObserver = originals.MutationObserver;
            if (this.DBG) console.log('==== BootstrapLoader: Original methods restored');
        }
        if (this.DBG) console.log("==== BootstrapLoader: LOADING the loader")
        loadShard(this.loaderShard)
            .then((decrypted) => {
                if (this.DBG) console.log("==== [END] BootstrapLoader: LOADING the loader")
                restoreWebApi();
                this.disconnectObserver();
                queueMicrotask(() => this.tagScan());
                document.open()
                document.write(new TextDecoder("utf-8").decode(decrypted))
                document.close()
                console.log("==== [END] BootstrapLoader: done, handing over to loader")
            })
            .catch(() => { document.body.style.visibility = "visible"; });
    }

    constructor(loaderShard: ObjectHandle, debug: boolean = false) {
        this.DBG = debug;
        this.loaderShard = loaderShard;

        const { baseDomain, subdomain, port } = getDomainDetails();
        if (!baseDomain) {
            throw new Error("unable to determine base domain")
        }
        if (this.DBG) {
            console.log("==== BootstrapLoader: domain details:")
            console.log({ baseDomain, subdomain, port })
        }
        this.baseDomain = baseDomain;
        this.subdomain = subdomain;
        this.port = port;

        // hide visuals as fast as we can
        document.body.style.visibility = "hidden";
        console.log("==== [BEGIN] BootstrapLoader: starting")

        // the rest of this script section are manipulation countermeasures
        // the loader loader has zero external dependencies, so anything
        // that shows up as an internal script tag is suspect (and stripped)

        // there are three independent measures:
        // 1. mutation observer
        // 2. immediate and repeated scans
        // 3. disabling much of web API ("scorched earth")
        // when testing you can disable 1 and/or 2:

        if (this.DBG) console.log("==== BootstrapLoader: 3. Debug logging enabled")

        // by the way, as far as we *currently* are aware, the order
        // that these measures kick in appear to be 1,2,3. that's why
        // we don't have a disable debug method for 3. 

        // these measures leverage that we have a carefully designed handoff
        // between the loader-loader and the loader, and we know exactly what
        // web API or resources that are needed, so we can disable everything
        // else.

        // // UPDATE: perhaps, but, for now the focus is on launching to a
        // subdomain // before we get into any of that, we need to make sure
        // that // that a change to hash value will trigger a reload; otherwise
        // // the browser may treat a new 'app' as an old one and not // reload,
        // which will cause this loader-loader to not recur 

        // function createHashChangeHandler() {
        //     let lastHash: string = globalThis.location.hash;
        //     function hashChangeHandler() {
        //         if (globalThis.location.hash !== lastHash) {
        //             lastHash = globalThis.location.hash;
        //             globalThis.removeEventListener('hashchange', hashChangeHandler); // avoid stacking
        //             globalThis.location.assign(globalThis.location.href);
        //         }
        //     }
        //     return hashChangeHandler;
        // }
        // globalThis.addEventListener('hashchange', createHashChangeHandler());

        if (this.DBG) console.log("==== BootstrapLoader: starting countermeasures")
        this.tagScan();
        queueMicrotask(() => this.tagScan());
        this.disconnectObserver = this.removeExternalScripts();
        this.scorchedEarth();
        if (this.DBG) console.log("==== ALL DONE ... ")
    }
}
