// (c) 2024 384 (tm)

// tabled code for now; this demonstrated how to have a 'scrape'
// feature from within a web app, in order to facilitate replicating/
// mirroring to shards. it also shows how to 'pace' multiple fetch operations.
// this code is still JS, and not refactored for lib3. 

// const MAX_FETCHES = 10;

// let fileBacklog = [];

// let numberFiles = 0;
// let totalData = 0;
// globalThis.numberFiles = numberFiles;
// globalThis.totalData = totalData;

// globalThis.fileBacklog = fileBacklog;
// let numberFetches = 0;

// const regex = /<script>globalThis\.__DATA__\s*=\s*({.+?})<\/script>/s;

// let scrapeFileList = [];

// function fetchFiles(base, path) {
//     return new Promise((resolve, reject) => {
//         let promiseList = [];
//         if (DBG0) console.log(`[${numberFetches}] Fetching ${base + path}`);
//         fetch(base + path + '/')
//             .then(response => response.text())
//             .then(text => {
//                 const match = text.match(regex);
//                 if (match) {
//                     const data = JSON.parse(match[1]);
//                     // console.log(data)
//                     Object.keys(data.target.details).forEach(key => {
//                         const item = data.target.details[key];
//                         // console.log(item)
//                         if (item.type === 'file') {
//                             console.log(`[${numberFetches}] FILE (${item.size} bytes): `, base + item.path);
//                             let row = { path: base.slice("https://unpkg.com/".length), name: item.path, size: item.size, type: item.contentType };
//                             scrapeFileList.push(row);
//                             globalThis.numberFiles++;
//                             globalThis.totalData += item.size;
//                         } else if (item.type === 'directory') {
//                             if (numberFetches > MAX_FETCHES) {
//                                 // console.log("DIRECTORY (backlog): ", base, item.path);
//                                 fileBacklog.push([base, item.path]);
//                             } else {
//                                 // console.log("DIRECTORY (promise): ", base, item.path);
//                                 numberFetches++;
//                                 promiseList.push(fetchFiles(base, item.path))
//                             }
//                         }
//                     });
//                 } else {
//                     console.error('No match');
//                 }
//                 Promise.all(promiseList).then(() => {
//                     promiseList = [];
//                     while (fileBacklog.length > 0) {
//                         const [base, path] = fileBacklog.pop();
//                         // console.log("Popping backlog", base, path);
//                         numberFetches++;
//                         promiseList.push(fetchFiles(base, path))
//                     }
//                 });
//                 numberFetches--;
//                 fileTable.renderTable(scrapeFileList, ["Package (unpkg.com)", "Name", "Size", "Content Type"],
//                     [false, false, false, false],
//                     "table-container",
//                     (newData) => { console.log("Updated table:"); console.log(newData); });
//                 resolve();
//             })
//             .catch(error => {
//                 console.error(error);
//                 reject();
//             });
//     });
// }

// function scrapeUnpkg(thePackage, path) {
//     console.log("Scraping " + thePackage + path)
//     fetchFiles(thePackage, path).then(() => {
//         console.log("DONE");
//         console.log("Number of files:", numberFiles);
//         console.log("Total data:", totalData);
//         console.log(globalThis.fileBacklog)
//     });
// }



// <!-- ToDo: this almost works, it has some CORS issues, not a priority for the moment
// <div>
//     <h2>Using other sources to populate list of files (Experimental)</h2>
//     <p>
//         You can also use these tools to "scrape", in particular,
//         this can be useful for packaging together a specific set
//         of libraries.
//     </p>
//     <p>
//         In this example, you can specifiy a package from "unpkg.com" .
//         Below you can just hit "Scrape" to pull the files from
//         the "monaco-editor" package. Or select another
//         package and path.
//     </p>
//     <p>
//     <form>
//         <p><label for="text-field">Select package and path: </label>
//             <input type="text" name="scrapePackage" size="40" value="https://unpkg.com/monaco-editor@0.27.0"
//                 placeholder="https://unpkg.com/monaco-editor@0.27.0">
//             <input type="text" name="scrapePath" value="/min/vs" placeholder="/min/vs">
//             <button class="file-upload" type="button"
//                 onclick="scrapeUnpkg(this.previousElementSibling.previousElementSibling.value, this.previousElementSibling.value)">Scrape</button>
//     </form>
//     </p>
// </div>
// -->