let express = require('express');
let router = express.Router();
let formidable = require('formidable');
let fs = require('fs');
let readLine = require('readline');
let Promise = require('promise');

/* GET home page. */
router.get('/', function (req, res, next) {
    if (req.mysqlConnection) {
        let getReleaseNames = 'select * from ReleaseName order by `order`';
        req.mysqlConnection.query(getReleaseNames, function (err, result, fiels) {
            if (result) {
                res.render('index', {
                    title: 'Localization',
                    releaseNames: result,
                    currentPage: ''
                });
            }
        })
    } else {
        res.render('index', {title: 'Localization'});
    }

});

router.post('/fixData', function (req, res, next) {
    let conn = req.mysqlConnection;
    let query = "select * from LineContent lc where `content` like '%=%=%'";
    conn.query(query, function (err, result, fields) {
        if (err) {
            throw err;
        } else {
            selfCallingFunction({
                currentIndex: 0,
                lastIndex: result.length,
                conn: conn,
                response: res,
                result: result
            });
        }
    });
});

function selfCallingFunction(data) {
    if (data.currentIndex == data.lastIndex) {
        data.response.end();
    } else {
        let query = "update LineContent set `value` = ? where id = ? ";
        new Promise((resolve, reject) => {
            let dataRow = data.result[data.currentIndex];
            let line = dataRow.content;
            let indexOfFirstEqualSign = line.indexOf("=");
            let newValue = line.substring(indexOfFirstEqualSign + 1, line.length);
            data.conn.query(query, [newValue, dataRow.id], function (err, result, fields) {
                if (err) {
                    reject(err);
                } else {
                    data.currentIndex = data.currentIndex + 1;
                    resolve();
                }
            });
        }).then(function () {
            selfCallingFunction(data);
        });
    }
}

function fixLineContent(composite) {
    let conn = composite.conn;
    let dataRow = composite.dataRow;
    let query = "update LineContent set `value` = ? where id = ? ";
    return new Promise(function (resolve, reject) {
        let line = dataRow.content;
        let indexOfFirstEqualSign = line.indexOf("=");
        let newValue = line.substring(indexOfFirstEqualSign + 1, line.length);
        conn.query(query, [newValue, dataRow.id], function (err, result, fields) {
            if (err) {
                reject(err);
            } else {
                if (composite.lastRow) {

                }
                resolve({
                    conn: conn
                });
            }
        });
    });
}

router.post('/uploadInterfaceFile', function (req, res, next) {
    let form = new formidable.IncomingForm();

    form.parse(req, function (err, fields, files) {
        let fileOrigin = fields.fileOrigin;
        if (files && files.propertyFile) {
            let path = files.propertyFile.path;
            if (path) {
                let readFileLineByLine = readLine.createInterface({
                    input: fs.createReadStream(path),
                    console: false
                });

                let keyParameterValues = [];
                readFileLineByLine.on('line', function (line) {
                    line = line.trim();
                    if (line.startsWith("String")) {
                        let indexOfLeftBracket = line.indexOf("(");
                        let beginningOfMethodName = 7;
                        let keyName = line.substring(7, indexOfLeftBracket);
                        let parameter = line.substring(indexOfLeftBracket, line.length);
                        keyParameterValues.push([fileOrigin, keyName, parameter]);
                    }
                }).on('close', function () {
                    let insertQuery = "insert into KeyParameter (fileOrigin, keyName, parameter) values ? ";
                    req.mysqlConnection.query(insertQuery, [keyParameterValues], function (err, result) {
                        if (err) throw err;
                        fs.unlink(path, function (err) {
                            if (err) throw err;
                            res.redirect('/');
                        });
                    });
                });
            }
        }
    });
});

router.post('/upload', function (req, res, next) {
    let form = new formidable.IncomingForm();
    form.parse(req, function (err, fields, files) {
        if (files && files.propertyFile) {
            let path = files.propertyFile.path;
            if (path) {
                let readFileLineByLine = readLine.createInterface({
                    input: fs.createReadStream(path),
                    console: false
                });
                let lineNumberCounter = 1;
                let lineContentValues = [];

                readFileLineByLine.on('line', function (line) {
                    line = line.trim();
                    let contentType = "comment";
                    if (!line.startsWith("#") && !line.startsWith("!") && line.indexOf("=") > 0) {
                        contentType = "localizedString";
                    }
                    let keyName = null;
                    let value = null;
                    let version = 1;
                    if (contentType === "localizedString") {
                        let indexOfFirstEqualSign = line.indexOf("=");

                        keyName = line.substring(0, indexOfFirstEqualSign).trim();
                        value = line.substring(indexOfFirstEqualSign + 1, line.length).trim();
                    }
                    lineContentValues.push([fields.fileOrigin, fields.language, line, lineNumberCounter, fields.releaseName,
                        fields.vcRevisionNumber, contentType, keyName, value, version]);
                    lineNumberCounter++;
                }).on('close', function () {
                    let insertIntoLineContentQuery = "insert into LineContentForFileGeneration (fileOrigin, lang, `content`, lineNumber, "
                        + "releaseName, vcRevisionNumber, contentType, keyName, `value`, version) values ? ";
                    req.mysqlConnection.query(insertIntoLineContentQuery, [lineContentValues], function (err, result) {
                        if (err) throw err;
                        fs.unlink(path, function (err) {
                            if (err) throw err;
                            res.redirect('/');
                        });
                    });
                });
            }
        }
    });
});

router.post("/populateGeneratedPropertiesFileData", function (req, res, next) {
    let lineContentForFileGenerationQuery = "select lcffg.keyName as keyName, lcffg.fileOrigin as fileOrigin, lcffg.value as value, kp.parameter as parameter from LineContentForFileGeneration lcffg" +
        " left join KeyParameter kp on lcffg.keyName = kp.keyName and lcffg.fileOrigin = kp.fileOrigin " +
        " where lcffg.contentType = 'localizedString' and lcffg.lang = 'en' ";
    let conn = req.mysqlConnection;
    conn.query(lineContentForFileGenerationQuery, function (err, result, fields) {
        let lineContentForFileGenerationData = result;
        let proposedKeyValuePairQuery = "select pkvp.keyName as newKeyName, pkvp.value as `value`, cck.keyName as oldKeyName, cck.fileOrigin as fileOrigin from ProposedKeyValuePair pkvp\n" +
            "join ProposedKeyValuePairOriginalKeyNames pkvpokn on pkvp.id = pkvpokn.proposedKeyValuePairId\n" +
            "join ConsolidationCandidateKeys cck on pkvpokn.originalKeyId = cck.id\n" +
            "where pkvp.verified = 1;";
        conn.query(proposedKeyValuePairQuery, function (err1, result1, fields1) {
            let proposedKeyValuePairData = result1;
            let reversedProposedKeyValuePairMap = {};

            proposedKeyValuePairData.forEach(function (row) {
                let tempKeyName = row.oldKeyName + '|' + row.fileOrigin;
                if (!reversedProposedKeyValuePairMap.hasOwnProperty(tempKeyName)) {
                    reversedProposedKeyValuePairMap[tempKeyName] = {
                        newKeyName: row.newKeyName,
                        fileOrigin: row.fileOrigin,
                        value: row.value
                    };
                }
            });

            let generatedPropertiesFileDataMap = {};

            lineContentForFileGenerationData.forEach(function (row1) {
                let tempKeyName = row1.keyName + '|' + row1.fileOrigin;
                let newKeyName;
                let usedInFrontEnd;
                let value;

                if (reversedProposedKeyValuePairMap.hasOwnProperty(tempKeyName)) {
                    newKeyName = reversedProposedKeyValuePairMap[tempKeyName].newKeyName;
                    usedInFrontEnd = reversedProposedKeyValuePairMap[tempKeyName].fileOrigin === '4' ? 0 : 1;
                    value = reversedProposedKeyValuePairMap[tempKeyName].value;
                } else {
                    newKeyName = row1.keyName;
                    usedInFrontEnd = row1.fileOrigin === '4' ? 0 : 1;
                    value = row1.value;
                }
                 
                if (!generatedPropertiesFileDataMap.hasOwnProperty(newKeyName)) {
                    generatedPropertiesFileDataMap[newKeyName] = [newKeyName, usedInFrontEnd, row1.parameter, value];
                } else {
                    if (generatedPropertiesFileDataMap[newKeyName][1] === 0) {
                        generatedPropertiesFileDataMap[newKeyName][1] = usedInFrontEnd;
                    }

                    if (generatedPropertiesFileDataMap[newKeyName][2] == null) {
                        generatedPropertiesFileDataMap[newKeyName][2] = row1.parameter;
                    }
                }
            });


            let generatedPropertiesFileData = [];

            let property;
            for (property in generatedPropertiesFileDataMap) {
                if (generatedPropertiesFileDataMap[property] !== '0' && generatedPropertiesFileDataMap[property] !== 0) {
                    generatedPropertiesFileData.push(generatedPropertiesFileDataMap[property]);
                }
            }

            let insertIntoGeneratedPropertiesFileDataQuery = "insert into NewKeyName (keyName, usedInFrontEnd, parameter, englishValue) values ? ";
            conn.query(insertIntoGeneratedPropertiesFileDataQuery, [generatedPropertiesFileData], function (err3, result3, fields3) {
                if (err3) {
                    throw err3;
                } else {
                    conn.query('delete from NewKeyName where usedInFrontEnd = 1 and parameter is null', function( err4, result4, fields4) {
                        if (err4) throw err4;
                        res.end();
                    });

                }
            });
        });
    });
});


router.get("/downloadFrontEndInterfaceFile", function (req, res, next) {
    let query = "select * from NewKeyName where usedInFrontEnd = 1 and parameter is not null order by keyName";
    let conn = req.mysqlConnection;
    conn.query(query, function(err, result, fields) {
        if (err) {
            throw err;
        } else {
            let text = "package com.jostleme.jostle.ui.localization;\n" +
                "\n" +
                "import com.google.gwt.i18n.client.Messages;\n" +
                "import com.jostleme.jostle.common.domain.MoreMenuType;\n" +
                "\n" +
                "public interface LocalizedStrings extends Messages{\n";
            result.forEach(function (row) {
                text += "\tString " + row.keyName + row.parameter ;
                if (row.parameter != null && row.parameter !== '();') {
                    text += " //TODO: check the parameter to see if the name still makes sense";
                }
                text += "\n";

                let additionalQuery = "select * from AdditionalNewKeyName2 order by keyName";
                conn.query(additionalQuery, function (err1, result1, fields1) {
                    if (err1) {
                        throw err1;
                    } else {
                        result1.forEach(function (row1) {
                            text += "\tString " + row1.keyName + row1.parameter ;
                            if (row1.parameter != null && row1.parameter !== '();') {
                                text += " //TODO: check the parameter to see if the name still makes sense";
                            }
                            text += "\n";
                        });
                        

                        text += "}";
                        res.set({
                            "Content-Disposition" : "attachment; filename = \"LocalizedString.java\""
                        });
                        res.send(text);
                    }
                });
            });


        }
    });
});

router.get("/downloadNewPropertiesFile", function (req, res, next) {
    let query = "select * from NewKeyName order by keyName";
    let conn = req.mysqlConnection;
    conn.query(query, function(err, result, fields) {
        if (err) {
            throw err;
        } else {
            let text = "";
            result.forEach(function (row) {
                text += row.keyName + '=' + row.englishValue + "\n";
            });

            let additionalQuery = "select * from AdditionalNewKeyName2 order by keyName";
            conn.query(additionalQuery, function (err1, result1, fields1) {
                if (err1) {
                    throw err1;
                } else {
                    result1.forEach(function (row1) {
                        text += row1.keyName + '=' + row1.englishValue + "\n";
                    });
                    res.set({
                        "Content-Disposition" : "attachment; filename = \"LocalizedString.properties\""
                    });
                    res.send(text);
                }

            });
        }
    });
});

router.get("/generateFrenchData", function (req, res, next) {
    let query = "select * from NewKeyName order by keyName";
    let conn = req.mysqlConnection;
    conn.query(query, function(err, result, fields) {
        if (err) {
            throw err;
        } else {
            let newKeyNameData = result;
            newKeyNameData.forEach(function (row) {
                                
            })
        }
    });
});

router.get("/generateReport", function (req, res, next) {
    let query = "select cc.`stringValue` as english, b.keyName, l.`value` as translation\n" +
        "from (\n" +
        "select * \n" +
        "from ConsolidationCandidateKeys c where c.stringId in\n" +
        "(select a.stringId from (select stringId, count(*) from ConsolidationCandidateKeys\n" +
        "\n" +
        "group by stringId\n" +
        "having count(*) > 1) a)) b join LineContentForFileGeneration l on b.keyName = l.keyName and b.fileOrigin = l.fileOrigin\n" +
        "join ConsolidationCandidate cc on b.stringId = cc.id\n" +
        "\n" +
        "and l.lang = 'de'\n" +
        "order by b.stringId";
    let conn = req.mysqlConnection;
    conn.query(query, function(err, result, fields) {
        if (err) {
            throw err;
        } else {
            let reportData = result;
            let map = {};
            reportData.forEach(function (row) {
                if (map.hasOwnProperty(row.english)) {
                    let found = false;
                    map[row.english].forEach(function (item) {
                        if (item.translation === row.translation) {
                            found = true;
                            item.keyNames.push(row.keyName);
                        }
                    });
                    if (!found) {
                        map[row.english].push({
                            translation: row.translation,
                            keyNames: [row.keyName]
                        });
                    }
                } else {
                    map[row.english] = [{
                        translation: row.translation,
                        keyNames: [row.keyName]
                    }];
                }
            });

            let finalReportMap = {};
            for (let property in map) {
                if (map[property].length > 1) {
                    finalReportMap[property] = map[property];
                }
            }

            let output = '';
            for (let property1 in finalReportMap) {
                output += property1 + "\r\n";
                finalReportMap[property1].forEach(function (item2) {
                    output += "\t" + item2.translation + "\r\n";
                    item2.keyNames.forEach(function (item3) {
                        output += "\t\t" + item3 + "\r\n";
                    });
                });
                output += "\r\n";
            }
            res.set({
                "Content-Disposition" : "attachment; filename = \"report.txt\""
            });
            res.send(output);
        }
    });
});

module.exports = router;
