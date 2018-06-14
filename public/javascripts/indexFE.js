function fixData() {
    $.ajax({
        method: "POST",
        url: "/fixData",

    }).done(function(response) {
        location.reload();
    });
}

function populateGeneratedPropertiesFileData() {
    $.ajax({
        method: "POST",
        url: "/populateGeneratedPropertiesFileData",

    }).done(function(response) {
        location.reload();
    });
}

function downloadFrontEndInterfaceFile() {
    window.open("/downloadFrontEndInterfaceFile", '_blank');
}

function downloadNewPropertiesFile() {
    window.open("/downloadNewPropertiesFile", '_blank');
}