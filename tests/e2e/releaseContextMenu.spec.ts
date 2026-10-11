import {test, expect, type Page} from '@playwright/test';
import {setupDeterministicNetwork} from './helpers/network';
import {seedStorageState} from './helpers/auth';
import {mockAnime1, createPagedResponse} from './fixtures/mockData';
import {defaultAppSettings} from '../../src/shared/types/settings';
async function fixture(page: Page, loggedIn=true) {
    await setupDeterministicNetwork(page,{isLoggedIn:loggedIn});
    await seedStorageState(page,{isLoggedIn:loggedIn,onboarded:true,settings:{...defaultAppSettings,appearance:{...defaultAppSettings.appearance,language:'english',theme:'light'}}});
    const current = {...mockAnime1,profile_list_status:1,is_favorite:false};
    const mutations:string[]=[];
    let reads=0, readFailures=0;
    let failMutation=false;
    let mutationGate: Promise<void> | undefined;
    let releaseMutation: (()=>void) | undefined;
    await page.route('https://api-s.anixsekai.com/**',async route=>{
        const path=new URL(route.request().url()).pathname;
        if(path.startsWith('/filter/'))return route.fulfill({json:createPagedResponse([current])});
        if(path==='/release/101'){reads++;if(readFailures-->0)return route.fulfill({status:503,json:{code:503}});return route.fulfill({json:{code:0,release:current}});}
        if(path.startsWith('/profile/list/add/') || /^\/favorite\/(add|delete)\//.test(path)) {
            mutations.push(path);
            if(mutationGate){const gate=mutationGate;mutationGate=undefined;await gate;}
            if(failMutation)return route.fulfill({status:503,json:{code:503}});
            if(path.startsWith('/profile/list/add/'))current.profile_list_status=Number(path.split('/')[4]);
            else current.is_favorite=path.includes('/add/');
            return route.fulfill({json:{code:0}});
        }
        if(path.startsWith('/favorite/all/'))return route.fulfill({json:createPagedResponse(current.is_favorite?[current]:[])});
        if(path.startsWith('/profile/list/all/'))return route.fulfill({json:createPagedResponse(current.profile_list_status===Number(path.split('/')[4])?[current]:[])});
        return route.fallback();
    });
    return {current,mutations,reads:()=>reads,failReads(count:number){readFailures=count;},pause(){mutationGate=new Promise<void>(resolve=>{releaseMutation=resolve;});},resume(){releaseMutation?.();},fail(){failMutation=true;},recover(){failMutation=false;},card:page.locator('a[href$="/anime/101"]').first()};
}
test('right-click menu moves a release and toggles favorites without navigation',async({page})=>{
    const f=await fixture(page);await page.goto('/');await f.card.waitFor();
    await f.card.click({button:'right'});
    const menu=page.getByRole('menu',{name:'Release actions',exact:true});
    await expect(menu).toBeVisible();await expect(page).not.toHaveURL(/anime\/101/);
    await menu.getByRole('menuitem',{name:'Move to list'}).click();
    await expect(menu.getByRole('menuitemradio',{name:'Watching',exact:true})).toHaveAttribute('aria-checked','true');
    await menu.getByRole('menuitemradio',{name:'Plan to watch',exact:true}).click();
    await expect(menu).toHaveCount(0);await expect(f.card).toContainText('Plan to watch');
    expect(f.mutations).toContain('/profile/list/add/2/101');
    await f.card.click({button:'right'});await menu.getByRole('menuitem',{name:'Add to favorites',exact:true}).click();
    await expect(menu).toHaveCount(0);expect(f.current.is_favorite).toBe(true);
    await f.card.click({button:'right'});await menu.getByRole('menuitem',{name:'Remove from favorites',exact:true}).click();
    await expect(menu).toHaveCount(0);expect(f.current.is_favorite).toBe(false);
    expect(f.mutations).toContain('/favorite/add/101');expect(f.mutations).toContain('/favorite/delete/101');
    expect(f.reads()).toBe(0);
});
test('keyboard submenu, Escape, outside click and viewport edges work',async({page})=>{
    const f=await fixture(page);await page.goto('/');await f.card.waitFor();await f.card.focus();
    await f.card.press('Shift+F10');
    const menu=page.getByRole('menu',{name:'Release actions',exact:true});
    const move=menu.getByRole('menuitem',{name:'Move to list'});
    await expect(move).toBeEnabled();await move.focus();await move.press('ArrowRight');
    const watching=menu.getByRole('menuitemradio',{name:'Watching',exact:true});await expect(watching).toBeFocused();
    await watching.press('Escape');await expect(move).toBeFocused();await expect(menu.getByRole('menuitemradio')).toHaveCount(0);
    await move.press('Escape');await expect(menu).toHaveCount(0);await expect(f.card).toBeFocused();
    await page.setViewportSize({width:390,height:844});await f.card.scrollIntoViewIfNeeded();
    await f.card.dispatchEvent('contextmenu',{clientX:389,clientY:843});await expect(move).toBeEnabled();await move.click();
    const fits=await menu.evaluate(element=>{const r=element.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;});expect(fits).toBe(true);
    await page.screenshot({path:'test-results/release-context-menu.png'});
    await page.mouse.click(1,1);await expect(menu).toHaveCount(0);
});
test('API failures keep the previous state and allow retry',async({page})=>{
    const f=await fixture(page);await page.goto('/');await f.card.waitFor();f.fail();await f.card.click({button:'right'});
    const menu=page.getByRole('menu',{name:'Release actions',exact:true});
    await menu.getByRole('menuitem',{name:'Add to favorites',exact:true}).click();await expect(menu.getByRole('alert')).toContainText('Could not save');
    expect(f.current.is_favorite).toBe(false);await expect(menu.getByRole('menuitem',{name:'Add to favorites',exact:true})).toBeEnabled();
    f.recover();await menu.getByRole('menuitem',{name:'Add to favorites',exact:true}).click();await expect(menu).toHaveCount(0);expect(f.current.is_favorite).toBe(true);
});
test('anonymous users get a sign-in action without mutation requests',async({page})=>{
    const f=await fixture(page,false);await page.goto('/');await f.card.waitFor();await f.card.click({button:'right'});
    const menu=page.getByRole('menu',{name:'Release actions',exact:true});await expect(menu.getByRole('menuitem',{name:'Move to list'})).toBeDisabled();
    await expect(menu.getByRole('menuitem',{name:'Sign in to manage lists.'})).toBeVisible();expect(f.mutations).toHaveLength(0);
});
test('moving from the active personal list refreshes it and removes the old card',async({page})=>{
    const f=await fixture(page);await page.goto('/favorites');await page.getByRole('tab',{name:'Watching',exact:true}).click();await f.card.waitFor();
    await f.card.click({button:'right'});const menu=page.getByRole('menu',{name:'Release actions',exact:true});
    await menu.getByRole('menuitem',{name:'Move to list'}).click();await menu.getByRole('menuitemradio',{name:'Completed',exact:true}).click();
    await expect(menu).toHaveCount(0);await expect(f.card).toHaveCount(0);expect(f.current.profile_list_status).toBe(3);
});

test('reopening a release menu while its mutation is pending cannot start a conflicting write',async({page})=>{
    const f=await fixture(page);await page.goto('/');await f.card.waitFor();f.pause();await f.card.click({button:'right'});
    const menu=page.getByRole('menu',{name:'Release actions',exact:true});
    await menu.getByRole('menuitem',{name:'Add to favorites',exact:true}).click();
    await expect.poll(()=>f.mutations.length).toBe(1);
    await page.mouse.click(1,1);await expect(menu).toHaveCount(0);await f.card.click({button:'right'});
    await expect(menu.getByRole('menuitem',{name:'Move to list'})).toBeDisabled();
    await expect(menu.getByRole('menuitem',{name:'Add to favorites',exact:true})).toBeDisabled();
    f.resume();
    await expect(menu.getByRole('menuitem',{name:'Remove from favorites',exact:true})).toBeEnabled();
    expect(f.mutations).toHaveLength(1);
    await menu.getByRole('menuitem',{name:'Remove from favorites',exact:true}).click();
    await expect(menu).toHaveCount(0);expect(f.current.is_favorite).toBe(false);
});

test('known card data needs zero detail requests even when that endpoint is unavailable',async({page})=>{
    const f=await fixture(page);f.failReads(10);await page.goto('/');await f.card.waitFor();
    const menu=page.getByRole('menu',{name:'Release actions',exact:true});
    for(let i=0;i<2;i++){
        await f.card.click({button:'right'});
        await expect(menu.getByRole('menuitem',{name:'Add to favorites',exact:true})).toBeEnabled();
        await expect(menu.getByRole('alert')).toHaveCount(0);
        await menu.getByRole('menuitem',{name:'Move to list'}).press('Escape');
        await expect(menu).toHaveCount(0);
    }
    expect(f.reads()).toBe(0);
});
test('ID-only fallback sends one request per attempt and clears its error on successful retry',async({page})=>{
    const f=await fixture(page);f.failReads(1);await page.goto('/');await f.card.waitFor();
    await f.card.evaluate(link=>{delete link.dataset.releaseListStatus;delete link.dataset.releaseFavorite;});
    await f.card.click({button:'right'});
    const menu=page.getByRole('menu',{name:'Release actions',exact:true});
    await expect(menu.getByRole('alert')).toContainText('Could not load');expect(f.reads()).toBe(1);
    await menu.getByRole('menuitem',{name:'Retry',exact:true}).click();
    await expect(menu.getByRole('menuitem',{name:'Add to favorites',exact:true})).toBeEnabled();
    await expect(menu.getByRole('alert')).toHaveCount(0);expect(f.reads()).toBe(2);
});
