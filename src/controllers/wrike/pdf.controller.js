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
 console.log(url,options);
}

module.exports = {
    generatePdf
};
