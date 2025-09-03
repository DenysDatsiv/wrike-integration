const puppeteer = require( 'puppeteer' );

async function clickElementByText( page,selector,text,{timeout = 10000} = {} ){
    await page.waitForSelector( selector,{timeout} );
    const handle = await page.evaluateHandle( ( sel,txt ) => {
        const nodes = Array.from( document.querySelectorAll( sel ) );
        return nodes.find( n => (n.textContent || '').trim() === txt ) || null;
    },selector,text );
    const element = handle.asElement();
    if ( ! element ) throw new Error( `Could not find element "${text}" for selector "${selector}"` );
    await element.click();
}

async function waitEnabledAndClick( page,selectorOrText,{timeout = 10000,isText = false} = {} ){
    if ( isText ){
        await clickElementByText( page,'button',selectorOrText,{timeout} );
        return;
    }
    const enabledSelector = `${selectorOrText}:not([disabled])`;
    await page.waitForSelector( enabledSelector,{timeout} );
    await page.click( enabledSelector );
}

async function interactWithModal( page,{persona,acceptText} = {} ){
    await clickElementByText( page,'button.button-light-outline',persona );

    const acceptButtonId = 'accept-persona-button';
    const acceptExists = await page.$( acceptButtonId );

    acceptExists ? await waitEnabledAndClick( page,acceptButtonId ) : await waitEnabledAndClick( page,acceptText,{isText:true} );

    await new Promise( resolve => setTimeout( resolve,300 ) );
}


async function generatePdf( url,options = {} ){
    let browser;
    try{
        browser = await puppeteer.launch( {
            headless:true,args:['--no-sandbox','--disable-setuid-sandbox']
        } );

        const page = await browser.newPage();

        await page.setViewport( {
            width:1920,height:1080,deviceScaleFactor:1
        } );

        await page.goto( url,{
            waitUntil:['load','domcontentloaded','networkidle0'],timeout:60000
        } );

        if ( options.modal ){
            await interactWithModal( page,options.modal );
            await page.waitForNetworkIdle( {idleTime:500,timeout:10000} ).catch( () => {
            } )
        }

        await page.evaluate( () => {
            return new Promise( ( resolve ) => {
                const images = Array.from( document.querySelectorAll( 'img' ) );
                let loadedImages = 0;

                if ( images.length === 0 ){
                    resolve();
                    return;
                }

                images.forEach( ( img ) => {
                    if ( img.complete ){
                        loadedImages ++;
                    }else{
                        img.onload = img.onerror = () => {
                            loadedImages ++;
                            if ( loadedImages === images.length ) resolve();
                        };
                    }
                } );

                if ( loadedImages === images.length ) resolve();

                setTimeout( resolve,10000 );
            } );
        } );

        await new Promise( ( resolve ) => setTimeout( resolve,2000 ) );
        await page.evaluateHandle( 'document.fonts.ready' );

        if ( options.delay ) await new Promise( ( r ) => setTimeout( r,options.delay ) );

        const bodyHandle = await page.$( 'body' );
        const boundingBox = await bodyHandle.boundingBox();
        await bodyHandle.dispose();

        const pdfBuffer = await page.pdf( {
            width:`${boundingBox.width}px`,
            height:`${boundingBox.height}px`,
            printBackground:true,
            margin:{top:'0px',right:'0px',bottom:'0px',left:'0px'},
            preferCSSPageSize:false,
            displayHeaderFooter:false,...options.pdfOptions
        } );

        return pdfBuffer;
    }catch ( error ){
        throw new Error( `Failed to generate PDF: ${error.message}` );
    }finally{
        if ( browser ) await browser.close();
    }
}

module.exports = {
    generatePdf
};
