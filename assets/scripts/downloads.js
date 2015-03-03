var Handlebars = require("hbsfy/runtime")
Handlebars.registerHelper("pluralize", require("handlebars-helper-pluralize"))
var template = require("../templates/package-downloads.hbs")

window.DownloadModel = require("../../models/download")

var getPackageCount = function() {

  try {
    var package = $("[data-package]").data().package
  } catch(e) {
    return
  }

  var container = $(".box.stats")
  if (!container.length) return

  var Download = new DownloadModel({
    host: "https://api.npmjs.org/downloads"
  })

  console.time(package)
  Download.getAll(package)
    .then(function(downloads){
      console.timeEnd(package)
      container.prepend(template({downloads: downloads}))
    })
    .catch(function(err){
      console.error(err)
    })
}

module.exports = function(){
  $(getPackageCount)
}
