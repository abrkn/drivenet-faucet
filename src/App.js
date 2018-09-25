import React, { Component } from 'react';
import logo from './logo.png';
import './App.css';
import { loadReCaptcha, ReCaptcha } from 'react-recaptcha-google';
import superagent from 'superagent';

class App extends Component {
  state = {
    address: '',
    status: '',
    recaptchaToken: null,
  };

  submit() {
    this.setState({ status: 'submitting' });

    const { recaptchaToken, address } = this.state;

    superagent
      .post('/api/drip')
      .send({ recaptchaToken, address })
      .then(response => {
        const { body } = response;
        const { amount, txhash } = body;
        const message = `Received ${amount} coins in tx ${txhash} !`;

        this.setState({ status: message });
      })
      .catch(error => this.setState({ status: `Error: ${(error.response && error.response.text) || error.message}` }));
  }

  componentDidMount() {
    loadReCaptcha();

    if (this.captchaDemo) {
      console.log('started, just a second...');
      this.captchaDemo.reset();
    }
  }

  onLoadRecaptcha() {
    if (this.captchaDemo) {
      this.captchaDemo.reset();
    }
  }

  render() {
    return (
      <div className="App">
        <header className="App-header">
          <img src={logo} className="App-logo" alt="logo" />
          <h1 className="App-title">Drivenet Faucet (TestDrive)</h1>
        </header>
        <form
          onSubmit={_ => {
            _.preventDefault();
            this.submit();
          }}
        >
          {false && (
            <ReCaptcha
              ref={el => {
                this.captchaDemo = el;
              }}
              size="compact"
              render="explicit"
              sitekey={process.env.REACT_APP_RECAPTCHA_SITE_KEY}
              verifyCallback={_ => this.setState({ recaptchaToken: _ })}
              onloadCallback={() => this.onLoadRecaptcha()}
            />
          )}
          <p>Type in your Drivenet address below:</p>
          <input type="text" value={this.state.address} onChange={_ => this.setState({ address: _.target.value })} />
          <button type="submit" disabled={!this.state.address}>
            Give Me Free Money
          </button>
        </form>

        {this.state.status && <p>{this.state.status}</p>}
      </div>
    );
  }
}

export default App;
