import puppeteer from 'puppeteer';
import { eachOfSeries } from 'async';
import fs from 'fs';
import download from 'download';
import { URL } from 'url';

const PRODUCT_DATA = [
	'https://www.google.com/search?q=plastic%20packaging%20of%20shirt&tbm=isch&hl=en&tbs=rimg:CUcagkYWeMi2Yauzs8WLRszpsgIOCgIIABAAKAE6BAgBEAE&sa=X&ved=0CBsQuIIBahcKEwjgtsqLieT3AhUAAAAAHQAAAAAQBg&biw=1903&bih=961',
	'https://www.google.com/search?q=shirt%20packed%20plastic%20bags&tbm=isch&tbs=rimg:Cdxsbs1jUzmHYQv6hSpEETxqsgIOCgIIABAAKAE6BAgBEAE&hl=en&sa=X&ved=0CBwQuIIBahcKEwiww6OVmOT3AhUAAAAAHQAAAAAQBw&biw=1903&bih=961',
	'https://www.google.com/search?q=t%20shirt%20packing%20plastic%20bags&tbm=isch&hl=en&tbs=rimg:Cffw76R3lYe9Yfr0F8Qyle888AEAsgIOCgIIABAAKAE6BAgBEAE&sa=X&ved=0CBwQuIIBahcKEwi4-PSzi-j3AhUAAAAAHQAAAAAQBw&biw=1903&bih=904',
	'https://www.google.com/search?q=plastic%20packaging%20of%20shirt&tbm=isch&hl=en&tbs=rimg:CZ0EmKO4a6Z_1Ye1YOuhl9BQK8AEAsgIOCgIIABAAKAE6BAgBEAE&sa=X&ved=0CB4QuIIBahcKEwjgxubFi-j3AhUAAAAAHQAAAAAQFw&biw=1903&bih=904',
	'https://www.google.com/search?q=plastic%20packaging%20of%20trousers&tbm=isch&hl=en&tbs=rimg:Ca9keqQIlpOAYcOMFMCVVFZi8AEAsgIOCgIIABAAKAE6BAgBEAE&sa=X&ved=0CBsQuIIBahcKEwjYu4L_i-j3AhUAAAAAHQAAAAAQBg&biw=1903&bih=904',
	'https://www.google.com/search?q=jeans%20packing%20plastic%20bags&tbm=isch&hl=en&tbs=rimg:CaX_1Glp-HzA8YdgAINM6kMeT8AEAsgIOCgIIABAAKAE6BAgBEAE&sa=X&ved=0CB4QuIIBahcKEwiY2PWUjOj3AhUAAAAAHQAAAAAQBg&biw=1903&bih=904',
];
const THREAD_COUNT = 4;
const MAX_PIC_COUNT = 100;
const IMAGE_LOAD_TIMEOUT = 15000;

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

async function downloadImage(url, dir, threadNum, productIndex, picIndex, maxPics) {
	if (url.toString().startsWith('data:')) {
		console.info(
			`Thread #${threadNum} | Product #${productIndex + 1} | Image #${picIndex + 1} of ${maxPics} | Download Failed`
		);
		return;
	}
	console.info(
		`Thread #${threadNum} | Product #${productIndex + 1} | Downloading Image #${picIndex + 1} of ${maxPics}`
	);
	try {
		await download(url, dir);
	} catch (error) {
		console.error(error);
	}
	return;
}

async function processImage(image, picIndex, productIndex, threadNum, dir, _page, maxPics) {
	try {
		console.info(
			`Thread #${threadNum} | Product #${productIndex + 1} | Processing Image #${picIndex + 1} of ${maxPics}`
		);
		await image.click();
		try {
			await _page.waitForSelector(
				'a[role="link"][href^="https://www.google.com/url"] > img[jsaction^="load"][src^="http"]',
				{
					timeout: IMAGE_LOAD_TIMEOUT,
				}
			);
		} catch (error) {
			console.info(
				`Thread #${threadNum} | Product #${productIndex + 1} | Image #${picIndex + 1} of ${maxPics} | Image Not Loading`
			);
		}
		const _imageSource = await _page.$eval(
			'a[role="link"][href^="https://www.google.com/url"] > img[jsaction^="load"]',
			(_imageElem) => _imageElem.getAttribute('src')
		);

		await downloadImage(_imageSource, dir, threadNum, productIndex, picIndex, maxPics);
	} catch (error) {
		console.error(error);
	}
}

async function processProduct(product, productIndex, totalLength, threadNum, _page) {
	try {
		console.info(`Thread #${threadNum} | Processing Product #${productIndex + 1} of ${totalLength} | ${product}`);

		// Define storage directory and search query
		const _URL = new URL(product);
		const dir = `./product_images/${decodeURI(_URL.searchParams.get('q')).replace(/\s/g, '_')}`;

		// Create storage directory (if does not exist)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		console.info(`Thread #${threadNum} | Product #${productIndex + 1} | Storage Directory Processed`);

		// Navigate tab to required page
		await _page.goto(product);
		console.info(`Thread #${threadNum} | Product #${productIndex + 1} | Product Search Page Loaded`);

		// Retrieve list of images
		const _imagesList = await _page.$$('div#islrg > div > div > a.islib');
		console.info(
			`Thread #${threadNum} | Product #${productIndex + 1} | Product Results Obtained | Count: ${_imagesList.length}`
		);

		// Calc pics to take
		const maxPics = MAX_PIC_COUNT > _imagesList.length ? _imagesList.length : MAX_PIC_COUNT;

		// Loop over list of images
		await eachOfSeries(_imagesList.slice(0, maxPics), async (image, _index) => {
			await processImage(image, _index, productIndex, threadNum, dir, _page, maxPics);
		});
		console.info(`Thread #${threadNum} | Product #${productIndex + 1} | Downloads Complete`);
	} catch (error) {
		console.error(error);
	}
}

async function runThread(PRODUCT_DATA, threadNum) {
	try {
		// Launch MS Edge as browser in headless mode (with slowmo to view changes)
		const _browser = await puppeteer.launch({
			headless: true,
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
