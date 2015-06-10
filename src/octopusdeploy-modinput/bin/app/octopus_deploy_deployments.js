var fs              = require("fs");
var path            = require("path");
var splunkjs        = require("splunk-sdk");
var request         = require("request")
var Async           = splunkjs.Async;
var ModularInputs   = splunkjs.ModularInputs;
var Logger          = ModularInputs.Logger;
var Event           = ModularInputs.Event;
var Scheme          = ModularInputs.Scheme;
var Argument        = ModularInputs.Argument;
var utils           = ModularInputs.utils;

var modName = "OCTOPUS DEPLOY MODINPUT";

exports.getScheme = function() {
    var scheme = new Scheme("Octopus Deploy Deployments");

    scheme.description = "Streams deployments from Octopus Deploy.";
    scheme.useExternalValidation = true;
    scheme.useSingleInstance = false; // Set to false so an input can have an optional interval parameter.

    scheme.args = [

        new Argument({
            name: "octopusDeployHost",
            dataType: Argument.dataTypeString,
            description: "The endpoint of Octopus Deploy (e.g. https://myOctopusServer/)",
            requiredOnCreate: true,
            requiredOnEdit: true
        }),
        new Argument({
            name: "apikey",
            dataType: Argument.dataTypeString,
            description: "The Octopus Deploy API access token.",
            requiredOnCreate: true,
            requiredOnEdit: true
        })

    ];

    return scheme;
};

exports.validateInput = function(definition, done) {

    var host = definition.parameters.octopusDeployHost;
    var apikey = definition.parameters.apikey;

    Logger.info(modName +  ": Validating Settings for Host:"+ host);

    try {

        if (host && host.length > 0 && apikey.length > 0) {

            validateOctoSettings(host, apikey, function(error, response, body){
                if(error){
                     done(new Error(error));
                }
                else{
                    done();
                }
            });
        }
    }
    catch (e) {
        done(e);
    }
};


exports.streamEvents = function(name, singleInput, eventWriter, done) {

    var checkpointDir = this._inputDefinition.metadata["checkpoint_dir"];

    var alreadyIndexed = 0;
    var uri = null;
    var working = true;

    Logger.info(name, modName + " Starting stream events for :");

    var host = singleInput.octopusDeployHost;
    var key = singleInput.apikey;


    Async.whilst(
        function() {
            return working;
        },
        function(callback) {
            try {

                var checkpointFilePath  = path.join(checkpointDir, key + ".txt");
                var checkpointFileNewContents = "";
                var errorFound = false;

                getDeploymentsPaged(host, key, uri, function(data){

                    var checkpointFileContents = checkFile(checkpointFilePath);

                    for (var i = 0; i < data.Items.length && !errorFound; i++) {

                        var octoEvent = data.Items[i];
                        Logger.info(name, modName + ": Checking Deployment Id - " + octoEvent.Id);


                        if (checkpointFileContents.indexOf(octoEvent.Id + "\n") < 0) {
                            try {

                                Logger.info(name, modName + ": Deployment Id - " + octoEvent.Id + " not found!");

                                var evt = mapToEvent(host, octoEvent);
                                eventWriter.writeEvent(evt);

                                // Append this commit to the string we'll write at the end
                                checkpointFileNewContents += octoEvent.Id + "\n";
                                Logger.info(name, modName + ":Indexed an Octopus Deploy Deployment: " + octoEvent.Id);
                            }
                            catch (e) {
                                errorFound = true;
                                working = false; // Stop streaming if we get an error.
                                Logger.error(name, e.message);
                                fs.appendFileSync(checkpointFilePath, checkpointFileNewContents); // Write to the checkpoint file
                                done(e);
                                return;
                            }
                        }
                        else {
                            Logger.info(name, modName + " :Already Indexed Deployment: " + octoEvent.Id);

                            alreadyIndexed++;
                        }
                    };

                    fs.appendFileSync(checkpointFilePath, checkpointFileNewContents); // Write to the checkpoint file

                    if (alreadyIndexed > 0) {
                        Logger.info(name, modName + ": Skipped " + alreadyIndexed.toString() + " already indexed Octopus Deploy Deployment from " + host + uri);
                    }

                    alreadyIndexed = 0;


                    if(data && data.Links && data.Links["Page.Next"]){
                        var nextUri = data.Links["Page.Next"];

                        Logger.info(name, modName +": Found more items to process :  " + nextUri);
                        uri = nextUri;
                    }
                    else{
                        Logger.info(name, modName + ": No more events!");

                        working = false
                        done();
                    }

                    callback();
                });

            }
            catch (e) {
                callback(e);
            }
        },
        function(err) {
            // We're done streaming.
            done(err);
        }
    );
};


checkFile = function(checkpointFilePath){

    var checkpointFileContents = "";

    try {
        checkpointFileContents = utils.readFile("", checkpointFilePath);
    }
    catch (e) {
        fs.appendFileSync(checkpointFilePath, "");
    }
    return checkpointFileContents;
}

mapToEvent = function (host, octoEvent){

    //TODO: Change to map in node

    var splunkEvent = new Event({
        stanza: host,
        sourcetype: "octopus:deployment",
        data: octoEvent, // Have Splunk index our event data as JSON, if data is an object it will be passed through JSON.stringify()
        time: Date.parse(octoEvent.Created) // Set the event timestamp to the time of the commit.
    });

    return splunkEvent;
}


getDeploymentsPaged = function(host, apikey, uri, onComplete, onError){
    if(!uri){
        uri = "api/deployments";
    }

    Logger.debug(modName +  ": Getting deployments for Host:"+ host + " Uri: " +uri);

    var options = {
        baseUrl: host,
        uri: uri,  // e.g. api/events?skip=30&user=
        headers: {
            'X-Octopus-ApiKey' : apikey
        }
    };

    function callback(error, response, body) {

        if(error){
            Logger.err(modName + ": An error occured calling host:"+ host + " Uri: " +uri)
            onError(error);
        }

        Logger.info("statusCode: ", response.statusCode); // <======= Here's the status code
        Logger.info("headers: ", response.headers);
        Logger.info("body: ", body);

        var data;

        try {
          data = JSON.parse(body);

        } catch (e) {
        }

        if(data){
            Logger.info(modName + " : Found " + data.Items.length + " deployments")
            onComplete(data);
        }
        else{
            Logger.err(modName + " There was an issue converting JSON")
        }
    }

    request(options, callback);

};


function validateOctoSettings(host, apikey, onComplete){

    var options = {
        baseUrl: host,
        uri: "api/users/me",
        headers: {
            'X-Octopus-ApiKey' : apikey
        }
    };

    function callback(error, response, body) {
        onComplete(error, response, body);
    }

    request(options, callback);
};
