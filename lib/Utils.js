const fs = require('fs');
const N3 = require('n3');
const jsonld = require('jsonld');
const jp = require('jsonpath');
const util = require('util');

const readfile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const appendFile = util.promisify(fs.appendFile);

module.exports = new class Utils {

    exists(path) {
        return fs.existsSync(path);
    }

    createFolder(path) {
        if (!fs.existsSync(path)) {
            fs.mkdirSync(path);
        }
    }

    async getFileContent(path) {
        return await readfile(path, 'utf8');
    }

    async overwriteFile(path, data) {
        return await writeFile(path, data);
    }

    async appendToFile(path, data) {
        return await appendFile(path, data);
    }

    async jsonld2Rdf(doc) {
        return await jsonld.toRDF(doc, { format: 'application/n-quads' });
    }

    async quads2String(quads, format, prefixes) {
        return new Promise((resolve, reject) => {
            let fmt = (format &&
                [
                    'text/turtle',
                    'application/trig',
                    'application/n-quads',
                    'N-Triples'
                ].includes(format)) ? format : 'application/trig';
            let writer = new N3.Writer({ format: fmt, prefixes: prefixes });

            writer.addQuads(quads);
            writer.end((err, res) => {
                if (err) reject(err);
                resolve(res);
            });
        });
    }

    getRDFStore(rdf) {
        let store = new N3.Store();
        return new Promise((resolve, reject) => {
            new N3.Parser().parse(rdf, (error, quad) => {
                if (error) {
                    reject(error);
                } else if (quad === null) {
                    resolve(store);
                } else {
                    store.addQuad(quad);
                }
            });
        });
    }

    getAllFragments(path) {
        return fs.readdirSync(path);
    }

    compactJsonldBlankNodes(graph) {
        let nodes = jp.nodes(graph, "$..['@id']");
        let ids = new Map();

        for (let i in nodes) {
            if (ids.has(nodes[i]['value'])) {
                let blankNode = null;
                let path = null;

                // See which is the Blank Node definition and which is the reference
                if (ids.get(nodes[i]['value']).length < nodes[i]['path'].length) {
                    ids.get(nodes[i]['value']).pop();
                    blankNode = ids.get(nodes[i]['value']);
                    nodes[i]['path'].pop();
                    path = nodes[i]['path'];
                } else {
                    nodes[i]['path'].pop();
                    blankNode = nodes[i]['path'];
                    ids.get(nodes[i]['value']).pop();
                    path = ids.get(nodes[i]['value']);
                }

                // Get Blank Node
                let bnValue = jp.value(graph, jp.stringify(blankNode));
                // Remove Blank Node id
                delete bnValue['@id'];
                // Make Blank Node a child element where it is being referenced
                jp.value(graph, jp.stringify(path), bnValue);
                // Delete original Blank Node
                graph.splice(blankNode[1], 1, "");
            } else {
                ids.set(nodes[i]['value'], nodes[i]['path']);
            }
        }
        // Clean up old Blank Node positions
        return graph.filter(el => el !== "");
    }

    dateBinarySearch(target, fragments) {
        let min = 0;
        let max = fragments.length - 1;
        let index = null;

        // Checking that target date is contained in the list of fragments.
        if (target <= fragments[min]) {
            index = min;
        } else if (target >= fragments[max]) {
            index = max;
        } else {
            // Perform binary search to find the fragment that contains the target date.
            while (index === null) {
                // Divide the array in half
                let mid = Math.floor((min + max) / 2);
                // Target date is in the right half
                if (target > fragments[mid]) {
                    if (target < fragments[mid + 1]) {
                        index = mid;
                    } else if (target === fragments[mid + 1]) {
                        index = mid + 1;
                    } else {
                        // Not found yet proceed to divide further this half in 2.
                        min = mid;
                    }
                    // Target date is exactly equals to the middle fragment
                } else if (target === fragments[mid]) {
                    index = mid;
                    // Target date is on the left half
                } else {
                    if (target >= fragments[mid - 1]) {
                        index = mid - 1;
                    } else {
                        max = mid;
                    }
                }
            }
        }

        return [new Date(fragments[index]), index];
    }

    getQuadsFromFile(path) {
        return new Promise(async (resolve, reject) => {
            let parser = new N3.Parser();
            let quads = [];
            parser.parse((await readfile(path)).toString(), (err, quad, prefixes) => {
                if (quad) {
                    quads.push(quad);
                } else {
                    console.log(prefixes);
                    resolve([prefixes, quads]);
                }
            });
        });
    }

    getQuadsFromString(text) {
        return new Promise(async (resolve, reject) => {
            let parser = new N3.Parser();
            let quads = [];

            parser.parse(text, (err, quad, prefixes) => {
                if (err) {
                    reject(err);
                }
                if (quad) {
                    quads.push(quad);
                } else {
                    resolve([prefixes, quads]);
                }
            });
        });
    }

    getFragmentsCount(path) {
        return fs.readdirSync(path).length;
    }

    getLiteralValue(literal) {
        return N3.Util.getLiteralValue(literal);
    }

    getTriplesBySPOG(array, s, p, o, g) {
        let temp = array;

        if (s) {
            temp = temp.filter(t => t.subject === s);
        }

        if (p) {
            temp = temp.filter(t => t.predicate === p);
        }

        if (o) {
            temp = temp.filter(t => t.object === o);
        }

        if (g) {
            temp = temp.filter(t => t.graph === g);
        }

        return temp;
    }
}