var Package = require("./package.json");

var OSS = require('ali-oss'),
	mime = require("mime"),
	uuid = require("uuid").v4,
	fs = require("fs"),
	request = require("request"),
	winston = module.parent.require("winston"),
	gm = require("gm"),
	im = gm.subClass({ imageMagick: true }),
	meta = module.parent.require("./meta"),
	db = module.parent.require("./database");

var plugin = {}

"use strict";

var client = null;
var settings = {
	"accessKeyId": process.env.OSS_ACCESS_KEY_ID || "",
	"secretAccessKey": process.env.OSS_SECRET_ACCESS_KEY || "",
	"region": process.env.OSS_DEFAULT_REGION || "oss-cn-hangzhou",
	"bucket": process.env.OSS_UPLOADS_BUCKET || undefined,
	"path": process.env.OSS_UPLOADS_PATH || undefined
};




function OSSClient() {
	if (!client) {
		client = new OSS({
			region: settings.region,
			accessKeyId: settings.accessKeyId,
			accessKeySecret: settings.secretAccessKey
		});
	}

	return client;
}

function makeError(err) {
	if (err instanceof Error) {
		err.message = Package.name + " :: " + err.message;
	} else {
		err = new Error(Package.name + " :: " + err);
	}

	winston.error(err.message);
	return err;
}


plugin.deactivate = function () {
	client = null;
};

plugin.load = function (params, callback) {

};





plugin.uploadImage = function (data, callback) {
	var image = data.image;

	if (!image) {
		winston.error("invalid image");
		return callback(new Error("invalid image"));
	}

	//check filesize vs. settings
	if (image.size > parseInt(meta.config.maximumFileSize, 10) * 1024) {
		winston.error("error:file-too-big, " + meta.config.maximumFileSize);
		return callback(new Error("[[error:file-too-big, " + meta.config.maximumFileSize + "]]"));
	}

	var type = image.url ? "url" : "file";

	if (type === "file") {
		if (!image.path) {
			return callback(new Error("invalid image path"));
		}

		fs.readFile(image.path, function (err, buffer) {
			uploadToOSS(image.name, err, buffer, callback);
		});
	}
	else {
		var filename = image.url.split("/").pop();

		var imageDimension = parseInt(meta.config.profileImageDimension, 10) || 128;

		// Resize image.
		im(request(image.url), filename)
			.resize(imageDimension + "^", imageDimension + "^")
			.setFormat('png')
			.stream(function (err, stdout, stderr) {
				if (err) {
					return callback(makeError(err));
				}

				// This is sort of a hack - We"re going to stream the gm output to a buffer and then upload.
				// See https://github.com/aws/aws-sdk-js/issues/94
				var buf = new Buffer(0);
				stdout.on("data", function (d) {
					buf = Buffer.concat([buf, d]);
				});
				stdout.on("end", function () {
					uploadToOSS(filename, null, buf, callback);
				});
			});
	}
};

plugin.uploadFile = function (data, callback) {
	var file = data.file;

	if (!file) {
		return callback(new Error("invalid file"));
	}

	if (!file.path) {
		return callback(new Error("invalid file path"));
	}

	//check filesize vs. settings
	if (file.size > parseInt(meta.config.maximumFileSize, 10) * 1024) {
		winston.error("error:file-too-big, " + meta.config.maximumFileSize);
		return callback(new Error("[[error:file-too-big, " + meta.config.maximumFileSize + "]]"));
	}

	fs.readFile(file.path, function (err, buffer) {
		uploadToOSS(file.name, err, buffer, callback);
	});
};

function uploadToOSS(filename, err, buffer, callback) {
	if (err) {
		return callback(makeError(err));
	}

	var ossPath;
	if (settings.path && 0 < settings.path.length) {
		ossPath = settings.path;

		if (!ossPath.match(/\/$/)) {
			// Add trailing slash
			ossPath = ossPath + "/";
		}
	}
	else {
		ossPath = "/";
	}

	var ossKeyPath = ossPath.replace(/^\//, ""); // OSS Key Path should not start with slash.

	var params = {
		Bucket: settings.bucket,
		ACL: "public-read",
		Key: ossKeyPath + uuid() + '.' + mime.getExtension(mime.getType(filename)),
		Body: buffer,
		ContentLength: buffer.length,
		ContentType: mime.getType(filename)
	};

	var ossClient = OSSClient();
	ossClient.useBucket(settings.bucket);
	ossClient.put(params.Key, buffer).then(function (result) {
		var host = "https://" + params.Bucket + "." + settings.region + ".aliyuncs.com";
		var url = result.url;
		if (settings.host && 0 < settings.host.length) {
			host = settings.host;
			// host must start with http or https
			if (!host.startsWith("http")) {
				host = "http://" + host;
			}
			url = host + "/" + params.Key
		}
		callback(null, {
			name: filename,
			url: url
		});
	}, function (err) {
		return callback(makeError(err));
	})
}

var admin = plugin.admin = {};

admin.menu = function (custom_header, callback) {
	custom_header.plugins.push({
		"route": "/plugins/ali-oss",
		"icon": "fa-envelope-o",
		"name": "Aliyun OSS"
	});

	callback(null, custom_header);
};

module.exports = plugin;
