import puppeteer, { Page } from "puppeteer";
import axios from "axios";
import fs from "fs";
import path from "path";

interface Chapter {
    chapterNumber: number;
    images: string[];
}

interface InfoTable {
    [key: string]: string;
}

interface Manhwa {
    title: string;
    alternateTitle: string;
    cover: string;
    description: string;
    info: InfoTable;
    chapters: Chapter[];
}

async function downloadImage(url: string, filepath: string): Promise<void> {
    const response = await axios({
        url,
        method: "GET",
        responseType: "stream",
    });
    return new Promise((resolve) => {
        response.data.pipe(fs.createWriteStream(filepath)).on("finish", resolve);
    });
}

async function scrapeManhwa(url: string, page: Page): Promise<Manhwa> {
    console.log(`Opening main page: ${url}`);
    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    const title = await page.$eval(".seriestucon .seriestuheader .entry-title", (el) => el.textContent!.trim());
    const alternateTitle = await page.$eval(".seriestucon .seriestuheader .seriestualt", (el) =>
        el.textContent!.trim()
    );
    const coverUrl = await page.$eval(".seriestucontent img", (img) => img.src);
    const description = await page.$eval(".seriestucontent .seriestucontentr .entry-content p", (el) =>
        el.textContent!.trim()
    );

    const coverPath = path.join(process.cwd(), "covers", `${title.replace(/[^a-zA-Z0-9]/g, "_")}.jpg`);
    fs.mkdirSync(path.dirname(coverPath), { recursive: true });
    await downloadImage(coverUrl, coverPath);
    console.log(`Cover downloaded to: ${coverPath}`);

    const info: InfoTable = await page.$eval(".seriestucontent table.infotable", (table) => {
        const rows = Array.from(table.querySelectorAll("tbody tr"));
        const result: InfoTable = {};
        rows.forEach((row) => {
            const key = row.querySelector("td:first-child")?.textContent?.trim() || "";
            const value = row.querySelector("td:last-child")?.textContent?.trim() || "";
            if (key && value) result[key] = value;
        });
        return result;
    });

    await page.waitForSelector("#chapterlist ul li .eph-num a", { timeout: 5000 });
    const chapterLinks = await page.$$eval("#chapterlist ul li .eph-num a", (anchors) =>
        anchors.map((a) => a.href).reverse()
    );
    console.log(`Found ${chapterLinks.length} chapters for ${title}.`);

    const chapters: Chapter[] = [];
    for (let i = 0; i < chapterLinks.length; i++) {
        const link = chapterLinks[i];
        const chapterNum = i + 1;
        console.log(`Visiting chapter ${chapterNum}: ${link}`);
        await page.goto(link, { waitUntil: "domcontentloaded", timeout: 30000 });

        const imageUrls = await page.$$eval("#readerarea img", (imgs) => imgs.map((img) => img.src));
        const chapterFolder = path.join(
            process.cwd(),
            "chapters",
            title.replace(/[^a-zA-Z0-9]/g, "_"),
            `chapter_${chapterNum}`
        );
        fs.mkdirSync(chapterFolder, { recursive: true });

        const imagePaths: string[] = [];
        for (let j = 0; j < imageUrls.length; j++) {
            const url = imageUrls[j];
            try {
                const imagePath = path.join(chapterFolder, `image_${j + 1}.jpg`);
                await downloadImage(url, imagePath);
                imagePaths.push(imagePath);
            } catch (error) {
                console.log(`Failed to download image from URL ${url} (chapter ${chapterNum}, image ${j + 1}):`, error);
            }
        }

        chapters.push({ chapterNumber: chapterNum, images: imagePaths });
        console.log(`Finished processing chapter ${chapterNum} with ${imagePaths.length} images`);
    }

    return { title, alternateTitle, cover: coverPath, description, info, chapters };
}

function saveToJson(manhwaData: Manhwa[]) {
    const jsonPath = path.join(process.cwd(), "manhwa_data.json");
    let existingData: Manhwa[] = [];

    if (fs.existsSync(jsonPath)) {
        existingData = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    }

    existingData.push(...manhwaData);
    fs.writeFileSync(jsonPath, JSON.stringify(existingData, null, 2));
    console.log("Data saved to manhwa_data.json");
}

async function main() {
    const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    const manhwaUrls = [
        "https://kiryuu01.com/manga/solo-leveling/",
        "https://kiryuu01.com/manga/solo-leveling-arise-hunter-origin/",
        "https://kiryuu01.com/manga/solo-leveling-ragnarok/",
        "https://kiryuu01.com/manga/solo-leveling-side-story/",
        "https://kiryuu01.com/manga/the-beginning-after-the-end/",
        "https://kiryuu01.com/manga/the-beginning-after-the-end-side-story-jasmine-wind-borne/",
    ];
    const manhwaData: Manhwa[] = [];

    for (const url of manhwaUrls) {
        const data = await scrapeManhwa(url, page);
        manhwaData.push(data);
    }

    saveToJson(manhwaData);
    await browser.close();
    console.log("Scraping completed.");
}

main();
