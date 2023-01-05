import puppeteer from 'puppeteer';
import csvtojson from 'csvtojson';
import { eachOfSeries } from 'async';
import fs from 'fs';
import download from 'download';

const PRODUCT_DATA_PATH = './phone_data.csv';
const THREAD_COUNT = 4;
const MAX_PIC_COUNT = 25;
const MEDIUM_IMAGE_LOAD_TIMEOUT = 10000;
const LARGE_IMAGE_LOAD_TIMEOUT = 15000;
const SEARCH_PREFIX = '';
const SEARCH_POSTFIX = 'Box';
const IS_HEADLESS = true;

function splitArray(arr, parts) {
	if (parts > 8) throw new Error('A maximum of 8 threads can be supported concurrently!');
	if (parts < 2) return [arr];

	var len = arr.length,
		out = [],
		i = 0,
		size;

	if (len % parts === 0) {
		size = Math.floor(len / parts);
		while (i < len) {
			out.push(arr.slice(i, (i += size)));
		}
	} else {
		while (i < len) {
			size = Math.ceil((len - i) / parts--);
			out.push(arr.slice(i, (i += size)));
		}
	}

	return out;
}

async function downloadImage(url, dir, type, threadNum, productIndex, picIndex, maxPics) {
	console.info(
		`Thread #${threadNum} | Product #${productIndex + 1} | ${type} | Downloading Image #${picIndex + 1} of ${maxPics}`
	);
	try {
		if (url.toString().startsWith('data:')) {
			const DATA_URL_REGEX = /^data:.+\/(.+);base64,(.*)$/;

			const _matches = url.match(DATA_URL_REGEX);
			const _ext = _matches[1];
			const _data = _matches[2];
			await fs.writeFileSync(
				`${dir}/${Math.random() * 100 * Math.random() * 100 * Math.random() * 1000}.${_ext}`,
				new Buffer(_data, 'base64')
			);
		} else {
			await download(url, dir);
		}
	} catch (error) {
		console.error(error);
	}
	return;
}

async function processImage(image, picIndex, productIndex, threadNum, dir, type, _page, maxPics) {
	try {
		console.info(
			`Thread #${threadNum} | Product #${productIndex + 1} | ${type} | Processing Image #${picIndex + 1} of ${maxPics}`
		);
		await image.click();
		try {
			await _page.waitForSelector('a[role="link"][href^="http"] > img[jsaction^="load"]', {
				timeout: type === 'MEDIUM' ? MEDIUM_IMAGE_LOAD_TIMEOUT : LARGE_IMAGE_LOAD_TIMEOUT,
			});
		} catch (error) {
			console.info(
				`Thread #${threadNum} | Product #${productIndex + 1} | ${type} | Image #${
					picIndex + 1
				} of ${maxPics} | Image Not Loading`
			);
		}
		const _imageSource = await _page.$eval('a[role="link"][href^="http"] > img[jsaction^="load"]', (_imageElem) =>
			_imageElem.getAttribute('src')
		);

		await downloadImage(_imageSource, dir, type, threadNum, productIndex, picIndex, maxPics);
	} catch (error) {
		console.error(error);
	}
}

async function processProduct(product, productIndex, totalLength, threadNum, _page) {
	try {
		console.info(
			`Thread #${threadNum} | Processing Product #${productIndex + 1} of ${totalLength} | ${product.key1} | ${
				product.key2
			} | ${product.key3}`
		);

		// Define storage directory and search query
		const dir = `./product_images/${product.key1.toLowerCase().replace(/\s/g, '_')}/${product.key2
			.toLowerCase()
			.replace(/\s/g, '_')}/${product.key3.toLowerCase().replace(/\s/g, '_')}`;
		const searchQueryText = `${SEARCH_PREFIX} ${product.key1} ${product.key2} ${product.key3} ${SEARCH_POSTFIX}`.trim();

		// Create storage directory (if does not exist)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		console.info(`Thread #${threadNum} | Product #${productIndex + 1} | Storage Directory Processed`);

		// Navigate tab to required page
		await _page.goto(`https://www.google.com/search?q=${encodeURI(searchQueryText)}&tbm=isch&tbs=isz:m`);
		console.info(`Thread #${threadNum} | Product #${productIndex + 1} | MEDIUM | Product Search Page Loaded`);

		// Retrieve list of images
		const _mediumImagesList = await _page.$$('div#islrg > div > div > a.islib');
		console.info(
			`Thread #${threadNum} | Product #${productIndex + 1} | MEDIUM | Product Results Obtained | Count: ${
				_mediumImagesList.length
			}`
		);

		// Calc pics to take
		const maxPicsMedium = MAX_PIC_COUNT > _mediumImagesList.length ? _mediumImagesList.length : MAX_PIC_COUNT;

		// Loop over list of images
		await eachOfSeries(_mediumImagesList.slice(0, maxPicsMedium), async (image, _index) => {
			await processImage(image, _index, productIndex, threadNum, dir, 'MEDIUM', _page, maxPicsMedium);
		});
		console.info(`Thread #${threadNum} | Product #${productIndex + 1} | MEDIUM | Downloads Complete`);

		// Navigate tab to required page
		await _page.goto(`https://www.google.com/search?q=${encodeURI(searchQueryText)}&tbm=isch&tbs=isz:l`);
		console.info(`Thread #${threadNum} | Product #${productIndex + 1} | LARGE | Product Search Page Loaded`);

		// Retrieve list of images
		const _largeImagesList = await _page.$$('div#islrg > div > div > a.islib');
		console.info(
			`Thread #${threadNum} | Product #${productIndex + 1} | LARGE | Product Results Obtained | Count: ${
				_largeImagesList.length
			}`
		);

		// Calc pics to take
		const maxPicsLarge = MAX_PIC_COUNT > _largeImagesList.length ? _largeImagesList.length : MAX_PIC_COUNT;

		// Loop over list of images
		await eachOfSeries(
			_largeImagesList.slice(0, maxPicsLarge),
			async (image, _index) =>
				await processImage(image, _index, productIndex, threadNum, dir, 'LARGE', _page, maxPicsLarge)
		);
		console.info(`Thread #${threadNum} | Product #${productIndex + 1} | LARGE | Downloads Complete`);
	} catch (error) {
		console.error(error);
	}
}

async function runThread(PRODUCT_DATA, threadNum) {
	try {
		// Launch MS Edge as browser in headless mode (with slowmo to view changes)
		const _browser = await puppeteer.launch({
			headless: IS_HEADLESS,
			slowMo: '250',
			executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
		});
		console.info(`Thread #${threadNum} | Launched Browser`);

		// Create new working tabs
		const _page = await _browser.newPage();
		console.info(`Thread #${threadNum} | Created Working Tab`);

		// Loop over each product entry
		await eachOfSeries(
			PRODUCT_DATA,
			async (product, index) => await processProduct(product, index, PRODUCT_DATA.length, threadNum, _page)
		);
		console.info(`Thread #${threadNum} | Complete`);

		await _browser.close();
		console.info(`Thread #${threadNum} | Broswer Closed`);
	} catch (error) {
		console.error(error);
	}
}

(async () => {
	try {
		// Retrieve product data from CSV file and convert to iterable JSON
		const PRODUCT_DATA = await csvtojson({
			delimiter: 'auto',
		}).fromFile(PRODUCT_DATA_PATH);
		console.info(`Main Thread | Read CSV File`);

		const _threadArrays = splitArray(PRODUCT_DATA, THREAD_COUNT);
		console.info(`Main Thread | Data split into ${THREAD_COUNT} parts.`);

		console.info(`Main Thread | Starting all threads...`);
		const threads = _threadArrays.map(runThread);

		await Promise.all(threads);
		console.info(`Main Thread | All Threads Complete`);
	} catch (error) {
		console.error(error);
	}
})();
