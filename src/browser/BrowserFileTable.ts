// (c) 2023-2024 384 (tm)

import { SBFile } from "src/file/SBFile";
import { ChannelApi } from "src/channel/ChannelApi";

/**
 * Helper class for handling file uploads. See sample apps for usage. It does alot.
 *  
 * @public
 * */
export class BrowserFileTable {
    tableRows = new Map();
    hasChanges = false;

    constructor(
        // public sbFileHelper: BrowserFileHelper,   // todo: might be needed to get 'delete' function back
        public findFileDetails: (hash: string) => SBFile | null,
        public docElements: {
            table: Element, // = document.querySelector('#myTable tbody');
            expandAll?: HTMLElement, // = document.getElementById("expandAll")
            collapseAll?: HTMLElement, // = document.getElementById("collapseAll")
            uploadNewSetButton?: HTMLElement, // = document.getElementById("uploadNewSetButton")
            tableFileInfo: HTMLElement, // = document.getElementById("table-file-info");
        },
        public callbacks: {
            rowClicked?: (metaData: any) => void | null,
            previewFile?: (hash: string, type: string) => void,
            downloadFile?: (hash: string, type: string, name: string) => void,
            copyLink?: (hash: string, type: string) => void,

        }
    ) {
        // if (!this.sbFileHelper) throw new Error("SBFileHelper is null")
        if (!this.docElements.table) throw new Error("table is null")
        if (!this.docElements.tableFileInfo) throw new Error("tableFileInfo is null")
        // if (!this.docElements.uploadNewSetButton) console.warn("uploadNewSetButton is null")
        // if (!this.docElements.expandAll) console.warn("expandAll is null")
        // if (!this.docElements.collapseAll) console.warn("collapseAll is null")
        // if (!this.callbacks.previewFile) throw new Error("previewFile is null")
    }

    addRow(lexicalOrder: any, rowContents: any, metaData: any) {
        this.tableRows.set(lexicalOrder, { rowContents, metaData });

        // Sort map keys in lexical order
        this.tableRows = new Map([...this.tableRows.entries()].sort().reverse());

        // Iterate over sorted map and add rows to the table
        this.docElements.table.innerHTML = "";
        for (let [_key, value] of this.tableRows) {
            let row = document.createElement('tr');
            let cell = document.createElement('td');
            cell.textContent = value.rowContents;

            // Attach click handler with metaData
            if (this.callbacks.rowClicked) {
                cell.addEventListener('click', () => {
                    if (this.docElements.expandAll) this.docElements.expandAll.style.display = "flex";
                    if (this.docElements.collapseAll) this.docElements.collapseAll.style.display = "flex";
                    this.callbacks.rowClicked!(value.metaData)
                });
            }

            row.appendChild(cell);
            this.docElements.table.appendChild(row);
        }
    }

    // note: 'editable' also doubles as 'omit' when null
    // first column is pretty much hard coded to expect a path
    renderTable(
        data: any[],
        headings: any[],
        editable: string | any[],
        location: any,
        onSave: any,
        actionButtons = true
    ) {
        console.log("Will render:", data.length, "rows:")
        console.log(data)

        // let originalData = JSON.parse(JSON.stringify(data));
        let originalData = data;
        let numberColumns = headings.length;
        if (numberColumns !== editable.length) {
            console.error("Number of headings and editable columns must match")
            return
        }
        let slatedForDeletion: any[] = [];
        const table = document.createElement("table");
        const thead = document.createElement("thead");
        const headingRow = document.createElement("tr");

        const saveBtn = document.createElement("button");
        const cancelBtn = document.createElement("button");

        const container = document.querySelector(`#${location}`)!;

        i = 0;
        let propertyNames: string[] = [];
        headings.forEach((heading: { label: string | null; key: any; }) => {
            if (editable[i++] !== null) {
                const headingCell = document.createElement("th");
                headingCell.textContent = heading.label;
                propertyNames.push(heading.key);
                headingRow.appendChild(headingCell);
            }
        });
        thead.appendChild(headingRow);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        let lastPath = '';

        data.forEach((row: { [x: string]: string | null; path?: any; hash?: any; type?: any; name?: any; }, index: any) => {
            // Count the number of slashes in the path
            const PATH_INDENT = 12;
            const depthPad = PATH_INDENT * (2 / 3) + (((row?.path?.match(/\//g) || []).length - 1)) * PATH_INDENT;

            if (row.path !== lastPath) {
                lastPath = row.path;
                const tableRow = document.createElement("tr");
                const tableData = document.createElement("td");
                tableData.colSpan = numberColumns;
                tableData.textContent = row.path;
                tableData.style.paddingLeft = depthPad + "px";
                tableRow.appendChild(tableData);
                tableRow.classList.add("folder");
                tableRow.dataset.name = row.path;
                tbody.appendChild(tableRow);
            }

            const tableRow = document.createElement("tr");
            tableRow.classList.add("file");
            tableRow.dataset.filePath = row.path;

            if (numberColumns > Object.keys(row).length) {
                // having extra (hidden) columns is fine
                console.error("Not enough columns in table for row: ", index)
                return
            }

            Object.keys(row).forEach((key, index) => {
                if (!propertyNames.includes(key))
                    return;

                if (editable[index] !== null) {
                    const tableData = document.createElement("td");
                    if (index == 0) {
                        tableData.style.paddingLeft = depthPad + PATH_INDENT + "px";
                    }
                    if (editable[index]) {
                        const input = document.createElement("input");
                        input.type = "text";
                        input.value = row[key]!;
                        input.addEventListener("input", () => {
                            row[key] = input.value;
                        });
                        tableData.appendChild(input);
                    } else {
                        if (editable[index] !== null) // null means skip
                            if ((key === "type") && (row[key] !== '')) {
                                if (!row.hash) throw new Error("row.hash is null")
                                tableData.dataset.hash = row.hash;
                                tableData.dataset.type = row.type;
                                tableData.dataset.path = row.path;
                                tableData.dataset.name = row.name;
                                tableData.innerHTML += row[key].slice(0, 20) + "<span class='preview-file-icon'>🔍👀</span><span style='margin-left: 8px' class='download-file-icon'>⬇️</span><span style='margin-left: 8px' class='copy-384-link-icon'>🔄</span>";
                            } else {
                                tableData.textContent = row[key];
                            }
                    }
                    tableRow.appendChild(tableData);
                }
            });

            if (actionButtons) {
                const deleteButton = document.createElement("button");
                deleteButton.textContent = "Remove";
                deleteButton.addEventListener("click", () => {
                    // document.getElementById("uploadNewSetButton")!.setAttribute("disabled", "true");
                    if (this.docElements.uploadNewSetButton) this.docElements.uploadNewSetButton.setAttribute("disabled", "true");
                    tableRow.classList.add("slated-for-deletion");
                    this.hasChanges = true;
                    saveBtn.removeAttribute("disabled");
                    cancelBtn.removeAttribute("disabled");
                    deleteButton.setAttribute("disabled", "true");
                    console.log("slated for deletion: ", index)
                    slatedForDeletion.push(row.hash)
                });
                const actionData = document.createElement("td");
                actionData.appendChild(deleteButton);
                tableRow.appendChild(actionData);
                if (tableRow.classList.contains("slated-for-deletion")) {
                    tableRow.classList.remove("slated-for-deletion");
                }
            }
            tbody.appendChild(tableRow);
        });
        table.appendChild(tbody);

        if (actionButtons) {
            saveBtn.setAttribute("id", "saveBtn")
            saveBtn.textContent = "Save";
            saveBtn.addEventListener("click", () => {
                // document.getElementById("uploadNewSetButton")!.removeAttribute("disabled");
                if (this.docElements.uploadNewSetButton) this.docElements.uploadNewSetButton.removeAttribute("disabled");
                // data = data.filter(row => !document.querySelector(`tr[data-index="${data.indexOf(row)}"]`).classList.contains("slated-for-deletion"));
                // data = data.filter(row => !row.classList.contains("slated-for-deletion"));
                console.log("hit save button. original:")
                console.log(originalData)
                data.forEach((item: { hash: any; }, _index: /* string | */ number) => {
                    if (slatedForDeletion.includes(item.hash)) {
                        throw new Error("slatedForDeletion needs to be updated")
                        // // basically, needs to remove file from what BrowserFileHelper is tracking
                        // console.log(this.sbFileHelper)
                        // console.log(this.sbFileHelper.finalFileList)
                        // console.log(data[index])
                        // // this.sbFileHelper.finalFileList.delete(data[index].fullName)
                        // // BrowserFileHelper.knownBuffers.delete(data[index].hash)
                        // console.log("deleting: ", index)
                        // console.log(data[index])
                        // delete data[index];
                    }
                });
                console.log("new:")
                console.log(data)
                // onSave(data);
                // originalData = JSON.parse(JSON.stringify(data));
                this.hasChanges = false;
                saveBtn.setAttribute("disabled", "true");
                cancelBtn.setAttribute("disabled", "true");

                this.renderTable(data, headings, editable, location, onSave);
            });
            table.appendChild(saveBtn);

            cancelBtn.setAttribute("id", "cancelBtn")
            cancelBtn.textContent = "Cancel";
            cancelBtn.addEventListener("click", () => {
                // document.getElementById("uploadNewSetButton")!.removeAttribute("disabled");
                if (this.docElements.uploadNewSetButton) this.docElements.uploadNewSetButton.removeAttribute("disabled");
                // data = JSON.parse(JSON.stringify(originalData));
                this.hasChanges = false;
                saveBtn.setAttribute("disabled", "true");
                cancelBtn.setAttribute("disabled", "true");
                console.log("hit cancel button. original:", data)
                this.renderTable(originalData, headings, editable, location, onSave);
            });

            if (this.hasChanges) {
                saveBtn.removeAttribute("disabled");
                cancelBtn.removeAttribute("disabled");
            } else {
                saveBtn.setAttribute("disabled", "true");
                cancelBtn.setAttribute("disabled", "true");
            }
            table.appendChild(cancelBtn);
        }
        container.innerHTML = "";
        container.appendChild(table);

        function toggleChildren(path: string) {
            var children = document.querySelectorAll<HTMLElement>('tr[data-file-path="' + path + '"]');
            console.log("toggling children: ", children)
            for (var j = 0; j < children.length; j++) {
                console.log("toggling: ", children[j])
                children[j].style.display = (children[j].style.display == 'none') ? '' : 'none';
            }
        }

        var nameCells = document.querySelectorAll('tr.folder');
        // console.log(nameCells)
        for (var i = 0; i < nameCells.length; i++) {
            nameCells[i].addEventListener('click', function (this: HTMLTableRowElement) {
                // copilot: "this" referes to the event target for the event listener for the "click" event
                // how do i tell typescript what "this" is referring to?
                if (this.dataset.name) {
                    console.log("Toggling children: ", this.dataset.name)
                    toggleChildren(this.dataset.name);
                } else {
                    console.error("this.dataset.name is null")
                }

                if (true) {
                    var children = document.querySelectorAll('tr[data-file-path="' + this.dataset.name + '"]');
                    console.log("click on")
                    console.log(this)
                    console.log(this.dataset.name)
                    console.log("found these children")
                    console.log(children)
                    for (var j = 0; j < children.length; j++) {
                        (children[j] as HTMLElement).style.display = ((children[j] as HTMLElement).style.display == 'none') ? '' : 'none';
                    }
                }
            });
        }

        // add an event listener for "click" on any of the preview-file-icon
        // elements we want to pass it the "type" and "hash" that will be in the
        // "data" attribute of the element and then we want to call the
        // "previewFile" function with those arguments we can do this by using
        // the "addEventListener" function

        document.querySelectorAll(".preview-file-icon").forEach((element) => {
            element.addEventListener("click", (event) => {
                if (!(event.target instanceof HTMLElement))
                    throw new Error("event.target is not an HTMLElement");
                if (!this.callbacks.previewFile)
                    throw new Error("config.callbacks.previewFile is null")
                // ToDo: why are these two not needed?
                // const path = (<HTMLElement>event.target).parentElement?.dataset.path;
                // const name = (<HTMLElement>event.target).parentElement?.dataset.name;
                const type = (<HTMLElement>event.target).parentElement?.dataset.type;
                const hash = (<HTMLElement>event.target).parentElement?.dataset.hash;
                const file = this.findFileDetails(hash!);
                console.log("file", file);
                if (!file)
                    throw new Error("file not found in fileSetMap (?) ... new issue");
                // const tableFileInfo = document.getElementById("table-file-info");
                this.docElements.tableFileInfo.innerHTML = "";
                const theader = document.createElement("thead");
                const tbody = document.createElement("tbody");
                const shard = ChannelApi.knownShards.get(hash!);
                const details = {
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    lastModified: file.lastModified,
                    SBDetails: null as string | null,
                }
                if (shard) {
                    details.SBDetails = `${shard.id}.${shard.verification}`
                }
                for (const [key, value] of Object.entries(details)) {
                    const tr = document.createElement("tr");
                    const th = document.createElement("th");
                    th.textContent = key;
                    const td = document.createElement("td");
                    td.textContent = value as string;
                    tr.appendChild(th);
                    tr.appendChild(td);
                    tbody.appendChild(tr);
                }
                this.docElements.tableFileInfo.appendChild(theader);
                this.docElements.tableFileInfo.appendChild(tbody);

                // this.previewFile(hash!, type!); // remove name, eg 'path! + name'
                this.callbacks.previewFile(hash!, type!); // remove name, eg 'path! + name'


                // for (const [key, value] of Object.entries(details)) {
                //     const tr = document.createElement("tr");
                //     const th = document.createElement("th");
                //     th.textContent = key;
                //     const td = document.createElement("td");
                //     td.textContent = value;
                //     tr.appendChild(th);
                //     tr.appendChild(td);
                //     tbody.appendChild(tr);
                // }
                // tableFileInfo!.appendChild(theader);
                // tableFileInfo!.appendChild(tbody);
                // this.previewFile(path + name, hash, type);
            });
        });

        document.querySelectorAll(".download-file-icon").forEach((element) => {
            element.addEventListener("click", (event) => {
                console.log(this.callbacks)
                if (!(event.target instanceof HTMLElement))
                    throw new Error("event.target is not an HTMLElement");
                if (!this.callbacks.downloadFile)
                    throw new Error("config.callbacks.downloadFile is null")
                // ToDo: why are these two not needed?
                // const path = (<HTMLElement>event.target).parentElement?.dataset.path;
                // const name = (<HTMLElement>event.target).parentElement?.dataset.name;
                const type = (<HTMLElement>event.target).parentElement?.dataset.type;
                const hash = (<HTMLElement>event.target).parentElement?.dataset.hash;
                const file = this.findFileDetails(hash!);
                console.log("file", file);
                if (!file)
                    throw new Error("file not found in fileSetMap (?) ... new issue");
                // const tableFileInfo = document.getElementById("table-file-info");
                this.docElements.tableFileInfo.innerHTML = "";
                const theader = document.createElement("thead");
                const tbody = document.createElement("tbody");
                const shard = ChannelApi.knownShards.get(hash!);
                const details = {
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    lastModified: file.lastModified,
                    SBDetails: null as string | null,
                }
                if (shard) {
                    details.SBDetails = `${shard.id}.${shard.verification}`
                }
                for (const [key, value] of Object.entries(details)) {
                    const tr = document.createElement("tr");
                    const th = document.createElement("th");
                    th.textContent = key;
                    const td = document.createElement("td");
                    td.textContent = value as string;
                    tr.appendChild(th);
                    tr.appendChild(td);
                    tbody.appendChild(tr);
                }
                this.docElements.tableFileInfo.appendChild(theader);
                this.docElements.tableFileInfo.appendChild(tbody);

                if (!file.name) {
                    console.error("[renderTable] file.name is null?")
                    file.name = "<UNKNOWN>"
                }
                this.callbacks.downloadFile(hash!, type!, file.name);
            });
        });

        document.querySelectorAll(".copy-384-link-icon").forEach((element) => {
            element.addEventListener("click", (event) => {
                if (!(event.target instanceof HTMLElement))
                    throw new Error("event.target is not an HTMLElement");
                if (!this.callbacks.copyLink)
                    throw new Error("config.callbacks.copyLink is null")
                // ToDo: why are these two not needed?
                // const path = (<HTMLElement>event.target).parentElement?.dataset.path;
                // const name = (<HTMLElement>event.target).parentElement?.dataset.name;
                const type = (<HTMLElement>event.target).parentElement?.dataset.type;
                const hash = (<HTMLElement>event.target).parentElement?.dataset.hash;
                const file = this.findFileDetails(hash!);
                console.log("file", file);
                if (!file)
                    throw new Error("file not found in fileSetMap (?) ... new issue");
                // const tableFileInfo = document.getElementById("table-file-info");
                this.docElements.tableFileInfo.innerHTML = "";
                const theader = document.createElement("thead");
                const tbody = document.createElement("tbody");
                const shard = ChannelApi.knownShards.get(hash!);
                const details = {
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    lastModified: file.lastModified,
                    SBDetails: null as string | null,
                }
                if (shard) {
                    details.SBDetails = `${shard.id}.${shard.verification}`
                }
                for (const [key, value] of Object.entries(details)) {
                    const tr = document.createElement("tr");
                    const th = document.createElement("th");
                    th.textContent = key;
                    const td = document.createElement("td");
                    td.textContent = value as string;
                    tr.appendChild(th);
                    tr.appendChild(td);
                    tbody.appendChild(tr);
                }
                this.docElements.tableFileInfo.appendChild(theader);
                this.docElements.tableFileInfo.appendChild(tbody);
                this.callbacks.copyLink(hash!, type!);


                // for (const [key, value] of Object.entries(details)) {
                //     const tr = document.createElement("tr");
                //     const th = document.createElement("th");
                //     th.textContent = key;
                //     const td = document.createElement("td");
                //     td.textContent = value;
                //     tr.appendChild(th);
                //     tr.appendChild(td);
                //     tbody.appendChild(tr);
                // }
                // tableFileInfo!.appendChild(theader);
                // tableFileInfo!.appendChild(tbody);
                // this.previewFile(path + name, hash, type);
            });
        });

    }

}
// globalThis.renderTable = renderTable;



// code prior to refactor ...

// function renderTable(data, headings, editable, location, onSave) {
//     // console.log("Will render:")
//     // console.log(data)
//     let numberColumns = headings.length;
//     if (numberColumns !== editable.length) {
//         console.error("Number of headings and editable columns must match")
//         return
//     }
//     let slatedForDeletion = [];
//     const table = document.createElement("table");
//     const thead = document.createElement("thead");
//     const headingRow = document.createElement("tr");

//     headings.forEach(heading => {
//         const headingCell = document.createElement("th");
//         headingCell.textContent = heading;
//         headingRow.appendChild(headingCell);
//     });
//     thead.appendChild(headingRow);
//     table.appendChild(thead);

//     const tbody = document.createElement("tbody");
//     let lastPath = '';
//     data.forEach((row, index) => {

//         // Count the number of slashes in the path
//         const PATH_INDENT = 12;
//         const depthPad = PATH_INDENT * (2 / 3) + (((row.path.match(/\//g) || []).length - 1)) * PATH_INDENT;

//         if (row.path !== lastPath) {
//             lastPath = row.path;
//             const tableRow = document.createElement("tr");
//             const tableData = document.createElement("td");
//             tableData.colSpan = numberColumns;
//             tableData.textContent = row.path;
//             tableData.style.paddingLeft = depthPad + "px";
//             tableRow.appendChild(tableData);
//             tableRow.classList.add("folder");
//             tableRow.dataset.name = row.path;
//             tbody.appendChild(tableRow);
//         }

//         const tableRow = document.createElement("tr");
//         tableRow.classList.add("file");
//         tableRow.dataset.filePath = row.path;

//         if (numberColumns > Object.keys(row).length) {
//             // having extra (hidden) columns is fine
//             console.error("Not enough columns in table for row: ", index)
//             return
//         }

//         Object.keys(row).slice(0, numberColumns).forEach((key, index) => {
//             const tableData = document.createElement("td");
//             if (index == 0) {
//                 tableData.style.paddingLeft = depthPad + PATH_INDENT + "px";
//             }
//             if (editable[index]) {
//                 const input = document.createElement("input");
//                 input.type = "text";
//                 input.value = row[key];
//                 input.addEventListener("input", () => {
//                     row[key] = input.value;
//                 });
//                 tableData.appendChild(input);
//             } else {
//                 if ((key === "type") && (row[key] !== '')) {
//                     tableData.dataset.hash = row.uniqueShardId;
//                     tableData.dataset.type = row.type;
//                     tableData.dataset.path = row.path;
//                     tableData.dataset.name = row.name;
//                     tableData.innerHTML += row[key] + " <span class='preview-file-icon'>🔍👀</span>";
//                 } else {
//                     tableData.textContent = row[key];
//                 }
//             }
//             tableRow.appendChild(tableData);
//         });

//         const deleteButton = document.createElement("button");
//         deleteButton.textContent = "Remove";
//         deleteButton.addEventListener("click", () => {
//             tableRow.classList.add("slated-for-deletion");
//             hasChanges = true;
//             saveBtn.removeAttribute("disabled");
//             cancelBtn.removeAttribute("disabled");
//             deleteButton.setAttribute("disabled", true);
//             slatedForDeletion[index] = true;
//         });
//         const actionData = document.createElement("td");
//         actionData.appendChild(deleteButton);
//         tableRow.appendChild(actionData);
//         if (tableRow.classList.contains("slated-for-deletion")) {
//             tableRow.classList.remove("slated-for-deletion");
//         }
//         tbody.appendChild(tableRow);
//     });
//     table.appendChild(tbody);

//     const saveBtn = document.createElement("button");
//     saveBtn.setAttribute("id", "saveBtn")
//     saveBtn.textContent = "Save";
//     saveBtn.addEventListener("click", () => {
//         // data = data.filter(row => !document.querySelector(`tr[data-index="${data.indexOf(row)}"]`).classList.contains("slated-for-deletion"));
//         // data = data.filter(row => !row.classList.contains("slated-for-deletion"));
//         console.log("hit save button. original:")
//         console.log(originalData)
//         slatedForDeletion.forEach((value, index) => {
//             if (value) {
//                 data.splice(index, 1);
//             }
//         });
//         console.log("new:")
//         console.log(data)
//         onSave(data);
//         originalData = JSON.parse(JSON.stringify(data));
//         hasChanges = false;
//         saveBtn.setAttribute("disabled", true);
//         cancelBtn.setAttribute("disabled", true);

//         renderTable(data, headings, editable, location, onSave);
//     });
//     const cancelBtn = document.createElement("button");
//     cancelBtn.setAttribute("id", "cancelBtn")
//     cancelBtn.textContent = "Cancel";
//     cancelBtn.addEventListener("click", () => {
//         data = JSON.parse(JSON.stringify(originalData));
//         hasChanges = false;
//         saveBtn.setAttribute("disabled", true);
//         cancelBtn.setAttribute("disabled", true);
//         renderTable(data, headings, editable, location, onSave);
//     });

//     if (hasChanges) {
//         saveBtn.removeAttribute("disabled");
//         cancelBtn.removeAttribute("disabled");
//     } else {
//         saveBtn.setAttribute("disabled", true);
//         cancelBtn.setAttribute("disabled", true);
//     }
//     table.appendChild(saveBtn);
//     // console.log(saveBtn)
//     table.appendChild(cancelBtn);
//     const container = document.querySelector(`#${location}`);
//     container.innerHTML = "";
//     container.appendChild(table);

//     function toggleChildren(path) {
//         var children = document.querySelectorAll('tr[data-file-path="' + path + '"]');
//         for (var j = 0; j < children.length; j++) {
//             children[j].style.display = (children[j].style.display == 'none') ? '' : 'none';
//         }
//     }

//     var nameCells = document.querySelectorAll('tr.folder');
//     // console.log(nameCells)
//     for (var i = 0; i < nameCells.length; i++) {
//         nameCells[i].addEventListener('click', function () {
//             toggleChildren(this.dataset.name);

//             // var children = document.querySelectorAll('tr[data-file-path="' + this.dataset.name + '"]');
//             // console.log("click on")
//             // console.log(this)
//             // console.log(this.dataset.name)
//             // console.log("found these children")
//             // console.log(children)
//             // for (var j = 0; j < children.length; j++) {
//             //     children[j].style.display = (children[j].style.display == 'none') ? '' : 'none';
//             // }
//         });
//     }

//     // add an event listener for "click" on any of the preview-file-icon elements
//     // we want to pass it the "type" and "hash" that will be in the "data" attribute of the element
//     // and then we want to call the "previewFile" function with those arguments
//     // we can do this by using the "addEventListener" function

//     document.querySelectorAll(".preview-file-icon").forEach((element) => {
//         element.addEventListener("click", (event) => {
//             const path = event.target.parentElement.dataset.path;
//             const name = event.target.parentElement.dataset.name;
//             const type = event.target.parentElement.dataset.type;
//             const hash = event.target.parentElement.dataset.hash;
//             previewFile(path + name, hash, type);
//         });
//     });

// }
// globalThis.renderTable = renderTable;

// let hasChanges = false;
