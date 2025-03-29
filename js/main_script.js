function request(url) {
	console.log('requesting url:');
	console.log(url);
	return new Promise(function (resolve, reject) {
		const xhr = new XMLHttpRequest();
		xhr.timeout = 10000;
		xhr.onreadystatechange = function(e) {
			if (xhr.readyState === 4) {
				if (xhr.status === 200) {
					resolve(xhr.response)
				} else {
					reject(xhr.status)
				}
			}
		}
		xhr.ontimeout = function () {
			reject('timeout')
		}
		xhr.open('get', url, true)
		xhr.send();
	});
}

function requestArrayBuffer(url) {
	console.log('requesting AB url:');
	console.log(url);
	return new Promise(function (resolve, reject) {
		const xhr = new XMLHttpRequest();
		xhr.timeout = 2000;
		xhr.onreadystatechange = function(e) {
			if (xhr.readyState === 4) {
				if (xhr.status === 200) {
					resolve(xhr.response)
				} else {
					console.log("rejecting with " + xhr.status);
					reject(xhr.status)
				}
			}
		}
		xhr.ontimeout = function () {
			reject('timeout')
		}
		xhr.responseType = 'arraybuffer';
		xhr.open('get', url, true)
		xhr.send();
	});
}

var imagePos = 0;
var failedLines = [];

const pdfPointsPerInch = 72;
const cardWidth = 2.5 * pdfPointsPerInch;// a card is 2.32 inch and 1 point is 1/72 inch
//const cardHeight = 3.25 * pdfPointsPerInch;
const pdfWidth = 8.26 * pdfPointsPerInch;
const pdfHeight= 11.69 * pdfPointsPerInch;



function addImageToDoc(doc) {
    return (img_url) => {
        console.log('image: ');
        console.log(img_url);
        
        // Create an image element and set its source to the image URL
        var img = new Image();
        img.src = img_url;
        
        img.onload = function() {
            var scaledWidth = cardWidth * document.getElementById("card_scale").value;
            console.log("scaledcardwith " + scaledWidth);
            var scaledHeight = scaledWidth / img.width * img.height;
            var scaledWidthPlusMargin = scaledWidth + Number(document.getElementById("margin_cards").value);
            console.log("cardwithplusmargin " + scaledWidthPlusMargin);
            var scaledHeightPlusMargin = scaledHeight + Number(document.getElementById("margin_cards").value);
            console.log(scaledWidthPlusMargin);
            var imgCountHorizontal = Math.floor((pdfWidth - 2 * document.getElementById("margin_document").value) / scaledWidthPlusMargin);
            var imgCountVertical = Math.floor((pdfHeight - 2 * document.getElementById("margin_document").value) / scaledHeightPlusMargin);
            
            if (imagePos >= imgCountHorizontal * imgCountVertical) {
                doc.addPage();
                imagePos = 0;
            }
            
            var xPos = imagePos % imgCountHorizontal;
            var yPos = Math.floor(imagePos / imgCountHorizontal);
            
            // Add the image to the PDF document
            doc.image(img, Number(document.getElementById("margin_document").value) + xPos * scaledWidthPlusMargin,
                Number(document.getElementById("margin_document").value) + yPos * scaledHeightPlusMargin, { width: scaledWidth });
            
            imagePos = (imagePos + 1);
        };
        
        img.onerror = function() {
            console.error('Failed to load image:', img_url);
        };
    };
}
var totalImages = 0;
var imagesDownloaded = 0;

function updateProgressBar() {
	const progressElement = document.querySelector('.progress');
	const progressPercentage = (imagesDownloaded / totalImages) * 100;
	progressElement.style.width = progressPercentage + '%';

	if (progressPercentage > 0) {
		progressElement.querySelector('.percent').textContent = Math.round(progressPercentage) + '%';
	}
}

function getImageUrl(cardNameOrId) {
	return () => {
		return request('https://api.scryfall.com/cards/named?fuzzy=' + encodeURIComponent(cardNameOrId))
			.then(function(result) {
				var data = JSON.parse(result);
				console.log('Requesting result');
				console.log(data);

				// Check if data contains single-face card image
				if (data.image_uris) {
					return [requestArrayBuffer(data.image_uris.png)];  // Return as an array for consistency
				} else if (data.card_faces && data.card_faces.length > 0) {
					// Handle multi-sided cards by returning images for all faces
					return Promise.all(
						data.card_faces.map(face => requestArrayBuffer(face.image_uris.png))
					);
				} else {
					throw new Error("Image URL not found");
				}
			}).then(function(images) {
				imagesDownloaded += 1;  // Increment for all faces downloaded
				updateProgressBar();
				return images;  // Return all images
			});
	};
}

function generateProxies() {
	imagePos = 0;
	failedLines = [];
	imagesDownloaded = 0;

	// Create a PDF document
	const doc = new PDFDocument({ size: document.getElementById("paper_size").value });

	// Pipe the document to a blob
	const stream = doc.pipe(blobStream());
	stream.on('finish', function() {
		const blob = stream.toBlob('application/pdf');
		saveAs(blob, "download.pdf");
	});

	var lines = document.getElementById("decklist_input").value.split('\n');
	totalImages = lines.length;
	var overallProcess = Promise.resolve();

	for (var i = 0; i < lines.length; i++) {
		if (/^\/\//.test(lines[i]) || /^#/.test(lines[i]) || /^!/.test(lines[i])) {
			console.log("skipping comment " + lines[i]);
			continue;
		}

		var regex_name = /^(?:([1-9][0-9]*)(?: ))?(.+)/;
		var regex_result = regex_name.exec(lines[i]);
		if (regex_result) {
			var number = regex_result[1] === undefined ? 1 : parseInt(regex_result[1]);
			console.log(lines[i]);
			console.log(regex_result);
			console.log("number: " + number);
			overallProcess = overallProcess.then(getImageUrl(regex_result[2]))
				.then(
					function(innerNumber) { 
						return (images) => Promise.all(
							// Flatten and process all images (multiple faces)
							images.flatMap(img => [...Array(innerNumber).keys()].map(i => addImageToDoc(doc)(img)))
						); 
					}(number),
					function(line) { 
						return () => failedLines.push(`${number} ${line}`); 
					}(regex_result[2], number)
				);
		}
	}

	overallProcess = overallProcess
		.then(() => tryFailed(doc))
		.then(() => doc.end())
		.catch(console.log.bind(console));
}

function tryFailed(doc) {
	if (failedLines.length > 0) {
		var error_message = "Could not process the following lines: \n";
		failedLines.forEach(line => error_message = error_message + "\n" + line);
		error_message = error_message + "\nDo you want to retry them?";

		// Prompt user if they want to retry failed lines
		if (confirm(error_message)) {
			let retryProcess = Promise.resolve();
			let retryFailedLines = [];

			for (let i = 0; i < failedLines.length; i++) {
				retryProcess = retryProcess
					.then(getImageUrl(failedLines[i]))
					.then(
						(img) => addImageToDoc(doc)(img),
						() => retryFailedLines.push(failedLines[i])
					);
			}

			return retryProcess
				.then(() => {
					// If retryFailedLines is still not empty, recursively call tryFailed
					if (retryFailedLines.length > 0) {
						failedLines = retryFailedLines; // Update failed lines with the ones that failed again
						return tryFailed(doc); // Recursively call if there are still failed lines
					}
				});
		}
	}
}

function dragOverHandler(e) {
	console.log('File(s) in drop zone'); 
	e.stopPropagation();
	e.preventDefault();
}

function dropHandler(ev) {
	console.log('File(s) dropped');

	// Prevent default behavior (Prevent file from being opened)
	ev.preventDefault();

	if (ev.dataTransfer.items) {
		// Use DataTransferItemList interface to access the file(s)
		for (var i = 0; i < ev.dataTransfer.items.length; i++) {
			// If dropped items aren't files, reject them
			if (ev.dataTransfer.items[i].kind === 'file') {
				var file = ev.dataTransfer.items[i].getAsFile();
				file.text()
					.then((content)=>{
						var ta = document.getElementById("decklist_input");
						ta.value = ta.value + content;
					});
				console.log('... file[' + i + '].name = ' + file.name);
			}
		}
	} else {
		// Use DataTransfer interface to access the file(s)
		for (var i = 0; i < ev.dataTransfer.files.length; i++) {
			console.log('... file[' + i + '].name = ' + ev.dataTransfer.files[i].name);
		}
	}
}



