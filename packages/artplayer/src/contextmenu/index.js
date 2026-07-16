import { isMobile } from '../utils'
import Component from '../utils/component'

export default class Contextmenu extends Component {
  constructor(art) {
    super(art)
    this.name = 'contextmenu'
    this.$parent = art.template.$contextmenu
  }

  init() {
    // No-op: contextmenu disabled
  }
}
