const fs = require('fs');
const n3 = require('n3');

module.exports = new class Utils {

    createFolder(path) {
        if (!fs.existsSync(path)) {
            fs.mkdirSync(path);
        }
    }

    getGeneratedAtTimeValue(rdf) {
        return new Promise((resolve, reject) => {
            n3.Parser().parse(rdf.toString(), (error, triple, prefixes) => {
                if (error) {
                    reject(error);
                }

                if (triple && triple.predicate === "http://www.w3.org/ns/prov#generatedAtTime") {
                    let n3Util = n3.Util;
                    resolve(new Date(n3Util.getLiteralValue(triple.object)));
                }
            });
        });
    }

    writeData(rdf, filePath) {
        return new Promise((resolve, reject) => {
            let parser = n3.Parser();
            let writer = n3.Writer({ format: 'application/trig' });
            let triples = parser.parse(rdf);

            writer.addTriples(triples);
            writer.end((err, res) => {
                fs.appendFile(filePath + '.trig', res, 'utf8', err => {
                    if (err) {
                        console.error(err);
                        reject(err);
                    }
                    resolve(res.length);
                });
            });
        });
    }

    getAllFragments(path) {
        return fs.readdirSync(path);
    }

    findFragment(time, folderPath) {
        let fragments = this.getAllFragments(folderPath).map(f => new Date(f.substring(0, f.indexOf('.trig'))).getTime());
        return this.dateBinarySearch(time.getTime(), fragments);
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

    getTriplesFromFile(path, format) {
        return new Promise((resolve, reject) => {
            let parser = n3.Parser();
            let triples = [];

            parser.parse(fs.readFileSync(path).toString(), async (err, triple, prefixes) => {
                if(triple) {
                    triples.push(triple);
                } else {
                    resolve(await this.formatTriples(format, triples, prefixes));
                }
            });
        });
    }

    formatTriples(format, triples, prefixes) {
        return new Promise((resolve, reject) => {
            let writer = n3.Writer({
                prefixes: prefixes,
                format: format
            });

            writer.addTriples(triples);
    
            writer.end((err, res) => {
                if(err) reject(err);
                resolve(res);
            });
        });
    }

    getFragmentsCount(path) {
        return fs.readdirSync(path).length;
    }
}