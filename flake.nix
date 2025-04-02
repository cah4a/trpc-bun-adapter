{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    bun-nixpkgs.url = "github:nixos/nixpkgs/f27f172be3bfa955a8d5a280ba60f12f90164ccb";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    nixpkgs,
    bun-nixpkgs,
    flake-utils,
    ...
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs {
        inherit system;

        config = {
          allowUnfree = true;
        };
      };

      bun-pkgs = import bun-nixpkgs {inherit system;};

      node = pkgs.nodejs-slim_22;
      bun = bun-pkgs.bun;
    in {
      devShell = pkgs.mkShell {
        buildInputs = [
          node
          bun
        ];

        env = {
          NODE_ENV = "development";
        };
      };
    });
}
