import {AfterContentInit, Directive, ElementRef, Input, Renderer} from '@angular/core';
import {Observable} from 'rxjs/index';
import {ExternalSource} from '../interfaces/external-source';
import {ExemplifyTexts} from '../interfaces/exemplify-texts';
import {WindowRef} from '../services/window-ref.service';
import {SourceService} from '../services/source.service';
import { forkJoin } from 'rxjs/observable/forkJoin'

@Directive({
  selector: '[exemplify]'
})
export class ExemplifyDirective implements AfterContentInit{

  @Input() target;
  @Input() source = 'element';
  @Input() customClass: string;
  @Input() externalSources: Array<ExternalSource>;
  @Input() usePrism = true;
  @Input() navStyle = 'inline';
  @Input() keepInputs = false;
  @Input('show') visibility = false;
  @Input() texts: ExemplifyTexts;
  @Input('exemplify') exemplifyId: any;
  @Input() escapeStrings: Array<string> = [];
  @Input() context: any;

  private copyMarkup: Function;
  private hideMarkup: Function;
  private hostElement;
  private element;
  private renderer;
  private window;
  private elementId;
  private code;
  private pre;
  private codeP;
  private parser;
  private activeItem;
  private activeListeners: Array<any> = [];
  private prism;
  private copyContent;
  private lastClass;
  private toggleState;
  private defaultTexts: ExemplifyTexts= {
    heading: 'Code:',
    markup: 'markup',
    copy: 'Copy',
    show: 'Show',
    hide: 'Hide',
  };
  private escapeAngularDirectives = [
    '*ngIf', '*ngFor', '*ngPluralCase', '*ngSwitchCase', '*ngSwitchDefault', 'ngClass', 'ngPlural', 'ngStyle', 'ngSwitch', 'ngTemplateOutlet', '[ngIf]', '[ngFor]', '[ngForOf]', '[ngPluralCase]', '[ngSwitchCase]', '[ngSwitchDefault]', 'ngModel'
  ];
  constructor(el: ElementRef, renderer: Renderer, private windowRef: WindowRef, private sourceService: SourceService) {

    this.hostElement = el.nativeElement;
    this.renderer = renderer;
    this.window = windowRef.nativeWindow;
    this.elementId = this.hostElement.getAttribute('id');
    this.parser = new DOMParser();
    this.prism = windowRef.nativeWindow.Prism;

  }

  /**
   * Copy to clipboard
   * @param {string} text - text to be copied to clipboard.
   */
  private copyToClipboard = function(text: string) {
    if (this.window.clipboardData && this.window.clipboardData.setData) {
      // IE specific code path to prevent textarea being shown while dialog is visible.
      return this.window.clipboardData.setData('Text', text);

    } else if (document.queryCommandSupported && document.queryCommandSupported('copy')) {
      const textarea = document.createElement('textarea');
      textarea.textContent = text;
      textarea.style.position = 'fixed';  // Prevent scrolling to bottom of page in MS Edge.
      document.body.appendChild(textarea);
      textarea.select();
      try {
        return document.execCommand('copy');  // Security exception may be thrown by some browsers.
      } catch (ex) {
        console.warn('Copy to clipboard failed.', ex);
        return false;
      } finally {
        document.body.removeChild(textarea);
      }
    }
  };


  ngAfterContentInit() {
    if (null == this.context) throw new Error('Input \'context\' is required, add [context]=\"this\" to set example context to current component.');

    this.texts = <ExemplifyTexts>this.extend(this.defaultTexts, this.texts);

    // add angular directives to the list of strings to escape
    this.escapeStrings.push(...this.escapeAngularDirectives);

    /** Get host element */
    let hostElement;
    if (this.target) {
      hostElement = this.renderer.createElement(this.target, 'div');
    } else {
      hostElement = this.renderer.createElement(this.hostElement, 'div');
    }

    this.renderer.setElementClass(hostElement, 'exemplify-wrapper', true);
    if (this.customClass){
      this.renderer.setElementClass(hostElement, this.customClass, true);
    }

    /** create div element to hold heading, hide/show and copy */
    const func = this.renderer.createElement(hostElement, 'div');
    this.renderer.setElementClass(func, ('exemplify-bar'), true);
    const funcSpan = this.renderer.createElement(func, 'span');
    this.renderer.createText(funcSpan, this.texts.heading);
    this.renderer.setElementClass(funcSpan, ('exemplify-label'), true);


    if (this.externalSources) {
      /** create nav element to hold links */
      const nav = this.renderer.createElement(hostElement, 'ul');
      this.renderer.setElementClass(nav, ('nav'), true);
      this.renderer.setElementClass(nav, ('nav-' + this.navStyle), true);
      /** Create link for toggling markup */
      this.addLink(nav, this.texts.markup, this.getHtmlMarkup());

      const links: Array<Observable<string>> = [];
      for (let i = 0; i < this.externalSources.length; i++) {
        links.push(this.sourceService.getSource(this.externalSources[i].src));
        this.sourceService.getSource(this.externalSources[i].src)
          .subscribe(
            code => {
              this.addLink(nav, this.externalSources[i].name, code, this.externalSources[i].language ? this.externalSources[i].language : 'typescript');
            }
          );
      }
      // wait until all sources have loaded...
      const example = forkJoin(links)
        .pipe()
        .subscribe(
          res => {
            this.addCopy(hostElement, func);
            this.addHide(hostElement, func);
            // ...add code container
            this.addCodeContainer(hostElement);
          }
        );
      /*Observable.forkJoin(links).subscribe(
        res => {
          this.addCopy(hostElement, func);
          this.addHide(hostElement, func);
          // ...add code container
          this.addCodeContainer(hostElement);
        }
      );*/
    } else {
      this.addCopy(hostElement, func);
      this.addHide(hostElement, func);
      // ...add code container
      this.addCodeContainer(hostElement);
    }

  }

  private showCode = function(code: string, language: string = 'markup', forceShow?: boolean){
    this.copyContent = code;
    if (this.usePrism && this.prism) {
      // remove last used class name (needed to clear class)
      if (this.lastClass){
        this.renderer.setElementClass(this.pre, 'language-' + this.lastClass, false);
        this.renderer.setElementClass(this.code, 'language-' + this.lastClass, false);
      }
      // add classes to element
      this.renderer.setElementClass(this.pre, 'language-' + language, true);
      this.renderer.setElementClass(this.code, 'language-' + language, true);
      this.lastClass = language;
      switch (language) {
        case 'typescript':
        case 'javascript':
        case 'js':
          language = 'js';
          break;
        case 'css':
          language = 'css';
          break;
        default:
          language = 'markup';
          break;
      }
      this.code.innerHTML = this.prism.highlight(code, this.prism.languages[language]);
    } else {
      this.renderer.setText(this.codeP, code);
    }
    this.toggleVisibility(this.pre, forceShow ? forceShow : this.visibility);
  };

  private addLink = function(hostElement, name: string, code?: any, language?: string) {

    /** Create link for toggling markup */
    const listItem = this.renderer.createElement(hostElement, 'li');
    this.renderer.setElementClass(listItem, 'nav-item', true);
    const renderElement = this.renderer.createElement(listItem, 'a');
    this.renderer.createText(renderElement, name);
    this.renderer.setElementAttribute(renderElement, 'href', '#');
    this.renderer.setElementClass(renderElement, 'nav-link', true);
    this.renderer.setElementClass(renderElement, 'exemplify-' + name.toLowerCase().replace(/[ ._]/g, '-'), true);

    if (this.activeListeners.length === 0){
      if (this.visibility) {
        this.renderer.setElementClass(renderElement, 'active', true);
      }
      this.activeItem = renderElement;
    }

    /** Add click listener */
    const listener = this.renderer.listen(renderElement, 'click', (event) => {
      this.removeActiveClass();

      this.renderer.setElementClass(renderElement, 'active', true);
      this.showCode(code, language, true);
      this.activeItem = renderElement;
      event.preventDefault();
    });
    this.activeListeners.push(listener);
    return renderElement;
  };

  private addHide = function(hostElement, navElement) {
    /** Create link for toggling markup */
    this.toggleState = this.renderer.createElement(navElement, 'a');
    const toggleState = this.renderer.createText(this.toggleState, this.texts.hide);
    this.renderer.setElementAttribute(this.toggleState, 'href', '#');
    this.renderer.setElementClass(this.toggleState, 'exemplify-hide', true);

    /** Add click listener for toggling markup example */
    this.hideMarkup = this.renderer.listen(this.toggleState, 'click', (event) => {
      event.preventDefault();
      //let content = this.parser.parseFromString(this.code.innerHTML,"text/html").body.childNodes[0].textContent;
      this.toggleVisibility(toggleState);
    });
    this.activeListeners.push(this.hideMarkup);
  };

  private addCopy = function(hostElement, navElement) {
    /** Create link for copying markup */
    const copy = this.renderer.createElement(navElement, 'a');
    this.renderer.createText(copy, this.texts.copy);
    this.renderer.setElementAttribute(copy, 'href', '#');
    this.renderer.setElementClass(copy, 'exemplify-copy', true);

    /** Add click listener for copying markup example */
    this.copyMarkup = this.renderer.listen(copy, 'click', (event) => {
      event.preventDefault();
      //let content = this.parser.parseFromString(this.code.innerHTML,"text/html").body.childNodes[0].textContent;
      this.copyToClipboard(this.copyContent);
    });
    this.activeListeners.push(this.copyMarkup);
  };



  private getHtmlMarkup = function() {
    /** Create markup example */

    try {
      if (!this.context) {
        console.log('No context set');
      }
      let markupExampleCode = this.context.constructor['__annotations__'][0];


      if (this.elementId) {
        markupExampleCode = this.parser.parseFromString(markupExampleCode.template, 'text/html').getElementById(this.elementId);
      } else if (this.exemplifyId) {

        const selector = '[exemplify="' + this.exemplifyId + '"]';
        const content = this.parser.parseFromString(markupExampleCode.template, 'text/html').querySelectorAll(selector);
        if (content.length > 1) {
          console.log('Exemplify warning! Multiple elements are using: "' + this.exemplifyId + '" as a identifier for the example, it should be a unique id. Returning first match.');
        }
        markupExampleCode = content[0];

      } else {
        console.log('Exemplify warning! No id set for example element, returning first match.');
        markupExampleCode = this.parser.parseFromString(markupExampleCode[0].template, 'text/html').querySelectorAll('[exemplify]')[0];
      }
      if (typeof markupExampleCode === 'undefined') {
        console.log('Exemplify warning! Can\'t show example as the component holding the markup couldn\'t be found!');
        return;
      }
      if (this.keepInputs !== true) {
        markupExampleCode.removeAttribute('exemplify');
        markupExampleCode.removeAttribute('id');
        markupExampleCode.removeAttribute('[externalsources]');
        markupExampleCode.removeAttribute('[source]');
        markupExampleCode.removeAttribute('[target]');
        markupExampleCode.removeAttribute('[customclass]');
        markupExampleCode.removeAttribute('[navstyle]');
        markupExampleCode.removeAttribute('[useprism]');
        markupExampleCode.removeAttribute('[escapestrings]');
        markupExampleCode.removeAttribute('[show]');
        markupExampleCode.removeAttribute('[context]');
      }

      /** Add markup content */
      let markupExampleString: string;
      switch (this.source){
        case 'child':
          markupExampleString = markupExampleCode.innerHTML;
          break;
        default:
          markupExampleString = markupExampleCode.outerHTML;
          break;
      }
      if (this.keepInputs === true) {
        // keep original format ie. avoid attributes being transformed into lowercase
        markupExampleString = markupExampleString.replace(/\[keepinputs]=/, '[keepInputs]=').replace(/\[externalsources]=/, '[externalSources]=').replace(/\[customclass]=/, '[customClass]=').replace(/\[navstyle]=/, '[navStyle]=').replace(/\[escapestrings]=/, '[escapeStrings]=');

      }
      if (this.escapeStrings) {
        // loop through items to and reset their casing, useful for inputs that will be converted to lower case otherwise
        for (let i = 0; i < this.escapeStrings.length; i++) {
          const lower = new RegExp('\\' + this.escapeStrings[i].toLowerCase(), 'g');
          markupExampleString = markupExampleString.replace(lower, this.escapeStrings[i]);
        }
      }

      // remove empty ="" form generated markup
      markupExampleString = markupExampleString.replace(/=""/g, '');

      return markupExampleString;
    } catch (error) {
      console.log(error);
      return '';
    }
  };

  private addCodeContainer = function(hostElement) {
    this.pre = this.renderer.createElement(hostElement, 'pre');
    this.code = this.renderer.createElement(this.pre, 'code');
    this.renderer.setElementClass(this.pre, 'markup-example', true);
    this.codeP = this.renderer.createText(this.code, '');
    this.showCode(this.getHtmlMarkup());
  };

  private removeListeners = function(){
    for (let i = 0; i < this.activeListeners.length; i++) {
      this.activeListeners[i]();
    }
  };

  private removeActiveClass = function(){

    if (this.activeItem) {
      this.renderer.setElementClass(this.activeItem, 'active', false);
    }
  };

  private toggleVisibility = function(element, forceShow?: boolean) {
    if (forceShow){
      this.renderer.setElementStyle(this.pre, 'display', 'block');
      this.toggleState.innerHTML = this.texts.hide;
      this.renderer.setElementClass(this.toggleState, 'exemplify-visible', true);
      this.visibility = true;
      return;
    }
    else if (forceShow === false) {
      this.renderer.setElementStyle(this.pre, 'display', 'none');
      this.toggleState.innerHTML = this.texts.show;
      this.renderer.setElementClass(this.toggleState, 'exemplify-visible', false);
      this.visibility = false;
      return;
    }
    if (this.visibility){
      this.removeActiveClass();
      this.renderer.setElementStyle(this.pre, 'display', 'none');
      this.renderer.setElementClass(this.toggleState, 'exemplify-visible', false);

    } else {
      if (this.activeItem) {
        this.renderer.setElementClass(this.activeItem, 'active', true);
      }
      this.renderer.setElementStyle(this.pre, 'display', 'block');
      this.renderer.setElementClass(this.toggleState, 'exemplify-visible', true);
    }
    this.visibility = !this.visibility;
    this.renderer.setText(element, this.visibility ? this.texts.hide : this.texts.show);

  };

  /**
   *  Extend object function.
   */
  private extend = function(a: Object, b: Object){
    for (const key in b)
      if (b.hasOwnProperty(key))
        a[key] = b[key];
    return a;
  };

  ngOnDestroy() {

    /** Remove click listeners */
    this.removeListeners();

  }

}
