const SphericalMercator = require('./spherical_mercator');


function getTileCount(zoom) {
    return Math.pow(2, zoom);
}

function tile2long(x, z) {
    const tileCount = getTileCount(z);
    return tileToLongitude(x, tileCount);
}

function tile2lat(y, z) {
    const tileCount = getTileCount(z);
    return tileToLatitude(y, tileCount);
}

function tileToLatitude(y, tileCount) {
    const radians = Math.atan(sinh(Math.PI - (2 * Math.PI * y) / tileCount));
    return (180 / Math.PI) * radians;
}

function tileToLongitude(x, tileCount) {
    return (x / tileCount) * 360 - 180;
}

function sinh(x) {
    return (Math.exp(x) - Math.exp(-x)) / 2;
}

class Projection {

    constructor({widthInPixels, heightInPixels, minXInDomain, maxXInDomain, minYInDomain, maxYInDomain, wLon = -180, sLat = -85.0511287798066, eLon = 180, nLat = 85.0511287798066}) {

        if (widthInPixels <= 0 || heightInPixels <= 0 || maxXInDomain - minXInDomain <= 0 || maxYInDomain - minYInDomain <= 0) {
            throw new Error('Cannot have unbounded domains');
        }

        this._widthInPixels = widthInPixels;
        this._heightInPixels = heightInPixels;
        this._minXInDomain = minXInDomain;
        this._maxXInDomain = maxXInDomain;
        this._minYInDomain = minYInDomain;
        this._maxYInDomain = maxYInDomain;

        if ((this._maxYInDomain - this._minYInDomain) <= 0) {
            throw new Error('Cannot have 0-height in domain');
        }

        this._pseudoMercator = new SphericalMercator();

        const [minx, miny] = this._pseudoMercator.forward([wLon, sLat]);
        this._mercatorMinX = minx;
        this._mercatorMinY = miny;
        const [maxx, maxy] = this._pseudoMercator.forward([eLon, nLat]);
        this._mercatorMaxX = maxx;
        this._mercatorMaxY = maxy;

    }

    getTransformationParams() {
        const scaleX = (this._mercatorMaxX - this._mercatorMinX) / (this._maxXInDomain - this._minXInDomain);
        const scaleY = (this._mercatorMaxY - this._mercatorMinY) / (this._maxYInDomain - this._minYInDomain);

        const translateX = this._mercatorMinX - (scaleX * this._minXInDomain);
        const translateY = this._mercatorMinY - (scaleY * this._minYInDomain);

        return {scaleX, scaleY, translateX, translateY};
    }

    projectDomainXYToWebMercatorXY(domainX, domainY) {
        const {scaleX, scaleY, translateX, translateY} = this.getTransformationParams();
        return {
            x: domainX * scaleX + translateX,
            y: domainY * scaleY + translateY
        };
    }

    reverseProjectWebMercatorXYToDomainXY(metersX, metersY) {
        const {scaleX, scaleY, translateX, translateY} = this.getTransformationParams();
        return {
            x: (metersX - translateX) / scaleX,
            y: (metersY - translateY) / scaleY
        };
    }

    //Use this to convert ES-query responses and pack into a tile
    convertDomainXYToLonLat(domainX, domainY) {
        const {x, y} = this.projectDomainXYToWebMercatorXY(domainX, domainY);
        const [lon, lat] = this._pseudoMercator.inverse([x, y]);
        return {lon, lat};
    }

    //Use this to convert map location to domain coordinate
    convertLonLatToDomainXY(lon, lat) {
        const [xMeters, yMeters] = this._pseudoMercator.forward([lon, lat]);
        return this.reverseProjectWebMercatorXYToDomainXY(xMeters, yMeters);
    }

    //Use this to get the ranges for the ES-queries
    convertTileXYZToDomainBbox(x, y, z) {

        const wLon = tile2long(x, z);
        const sLat = tile2lat(y + 1, z);
        const eLon = tile2long(x + 1, z);
        const nLat = tile2lat(y, z);

        const [wMeters, sMeters] = this._pseudoMercator.forward([wLon, sLat]);
        const [eMeters, nMeters] = this._pseudoMercator.forward([eLon, nLat]);

        const minXY = this.reverseProjectWebMercatorXYToDomainXY(wMeters, sMeters);
        const maxXY = this.reverseProjectWebMercatorXYToDomainXY(eMeters, nMeters);

        return {
            minX: minXY.x,
            minY: minXY.y,
            maxX: maxXY.x,
            maxY: maxXY.y
        };
    }

    // Use this to convert a mouse-position to coordinates in the domain
    // pixelXY is viewport with top-left = (0,0)
    convertPixelXYToDomainXY(pixelX, pixelY, wLonOfMap, sLatOfMap, eLonOfMap, nLatOfMap) {

        const [wMeters, sMeters] = this._pseudoMercator.forward([wLonOfMap, sLatOfMap]);
        const [eMeters, nMeters] = this._pseudoMercator.forward([eLonOfMap, nLatOfMap]);

        const scaleX = (this._widthInPixels - 0) / (eMeters - wMeters);
        const scaleY = (0 - this._heightInPixels) / (nMeters - sMeters); //orientation of world->view is flipped

        const translateX = 0 - (scaleX * wMeters);
        const translateY = this._heightInPixels - (scaleY * sMeters);

        const xMeters = (pixelX - translateX) / scaleX;
        const yMeters = (pixelY - translateY) / scaleY;

        return this.reverseProjectWebMercatorXYToDomainXY(xMeters, yMeters);
    }

}

const minXInDomain = 0;
const maxXInDomain = 1000;

const minYInDomain = -1;
const maxYInDomain = 1;

const widthInPixels = 1000;
const heightInPixels = 1000;

const projection = new Projection({
    widthInPixels,
    heightInPixels,
    minXInDomain,
    maxXInDomain,
    minYInDomain,
    maxYInDomain
});

let domainX, domainY;

//Bottom left of the screen
console.log('-----------------------------------');
domainX = minXInDomain;
domainY = minYInDomain;
const bottomLeftInMeters = projection.projectDomainXYToWebMercatorXY(domainX, domainY);
const bottomLeftInLonLat = projection.convertDomainXYToLonLat(domainX, domainY);
console.log({bottomLeftInMeters, bottomLeftInLonLat});


//Center of the screen
console.log('-----------------------------------');
domainX = (maxXInDomain + minXInDomain) / 2;
domainY = (maxYInDomain + minYInDomain) / 2;
const nullIslandInMeters = projection.projectDomainXYToWebMercatorXY(domainX, domainY);
const nullIslandInLonLat = projection.convertDomainXYToLonLat(domainX, domainY);
console.log({nullIslandInMeters, nullIslandInLonLat});

//top rifght of the screen
console.log('-----------------------------------');
domainX = maxXInDomain;
domainY = maxYInDomain;
const topRightInMeters = projection.projectDomainXYToWebMercatorXY(domainX, domainY);
const topRightInLonLat = projection.convertDomainXYToLonLat(domainX, domainY);
console.log({topRightInMeters, topRightInLonLat});


//tiles
console.log('-----------------------------------');

//zoom level 9
const entireDomain = projection.convertTileXYZToDomainBbox(0, 0, 0);
console.log({entireDomain});


//Zoom level 1
const topLeftDomain = projection.convertTileXYZToDomainBbox(0, 0, 1);
const bottomLeftDomain = projection.convertTileXYZToDomainBbox(0, 1, 1);
const topRightDomain = projection.convertTileXYZToDomainBbox(1, 0, 1);
const bottomRightDomain = projection.convertTileXYZToDomainBbox(1, 1, 1);

console.log({topLeftDomain, bottomLeftDomain, topRightDomain, bottomRightDomain});


console.log('-----------------------------------');

//Zoomed out
const topLeft = projection.convertPixelXYToDomainXY(0, 0, -180, -90, 180, 90);
const bottomLeft = projection.convertPixelXYToDomainXY(0, heightInPixels, -180, -90, 180, 90);
const middle = projection.convertPixelXYToDomainXY(widthInPixels / 2, heightInPixels / 2, -180, -90, 180, 90);
const topRight = projection.convertPixelXYToDomainXY(widthInPixels, 0, -180, -90, 180, 90);
const bottomRight = projection.convertPixelXYToDomainXY(widthInPixels, heightInPixels, -180, -90, 180, 90);

console.log({topLeft, bottomLeft, middle, topRight, bottomRight});


//Zoomed in on bottom left
const topLeftBl = projection.convertPixelXYToDomainXY(0, 0, -180, -90, 0, 0);
const bottomLeftBl = projection.convertPixelXYToDomainXY(0, heightInPixels, -180, -90, 0, 0);
const middleBl = projection.convertPixelXYToDomainXY(widthInPixels / 2, heightInPixels / 2, -180, -90, 0, 0);
const topRightBl = projection.convertPixelXYToDomainXY(widthInPixels, 0, -180, -90, 0, 0);
const bottomRightBl = projection.convertPixelXYToDomainXY(widthInPixels, heightInPixels, -180, -90, 0, 0);

console.log({topLeftBl, bottomLeftBl, middleBl, topRightBl, bottomRightBl});

//Zoomed in on top right
const topLeftTR = projection.convertPixelXYToDomainXY(0, 0, 0, 0, 180, 90);
const bottomLeftTR = projection.convertPixelXYToDomainXY(0, heightInPixels, 0, 0, 180, 90);
const middleTR = projection.convertPixelXYToDomainXY(widthInPixels / 2, heightInPixels / 2, 0, 0, 180, 90);
const topRightTR = projection.convertPixelXYToDomainXY(widthInPixels, 0, 0, 0, 180, 90);
const bottomRightTR = projection.convertPixelXYToDomainXY(widthInPixels, heightInPixels, 0, 0, 180, 90);

console.log({topLeftTR, bottomLeftTR, middleTR, topRightTR, bottomRightTR});


console.log('-----------------------------------');
const domain = projection.convertLonLatToDomainXY(0,0);
console.log({domain});






