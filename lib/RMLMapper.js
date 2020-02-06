const RMLMapperWrapper = require('@rmlio/rmlmapper-java-wrapper');
const yarrrml = require('@rmlio/yarrrml-parser/lib/rml-generator');
const fs = require('fs');
const Utils = require('./Utils');

const rmlmapperPath = './mappings/rmlmapper.jar';
const tempFolderPath = './mappings/tmp';
const wrapper = new RMLMapperWrapper(rmlmapperPath, tempFolderPath, true);

async function yarrrml2rml(yml) {
    try {
        let quads = new yarrrml().convert(fs.readFileSync(yml, 'utf-8'));
        return await Utils.quads2String(quads, 'application/trig');
    } catch(err) {
        console.error(err);
    }
}

async function map(rml, source) {
    
    const sources = {
        'data.json': source
    };

    return await wrapper.execute(rml, {sources, generateMetadata: false});
}

module.exports = {
    yarrrml2rml: yarrrml2rml,
    map: map
};