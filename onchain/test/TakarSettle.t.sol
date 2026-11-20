// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TakarSettle, IERC20} from "../src/TakarSettle.sol";

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) { balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[to] += a; return true;
    }
}

contract TakarSettleTest is Test {
    MockUSDC usdc;
    TakarSettle s;
    address resolver = address(0xA11CE);
    address payer = address(0xB0B);
    address payee = address(0xCAFE);
    bytes32 constant SIG = keccak256("telegraph signal");

    function setUp() public {
        usdc = new MockUSDC();
        s = new TakarSettle(IERC20(address(usdc)), resolver);
        usdc.mint(payer, 100e6);
        vm.prank(payer);
        usdc.approve(address(s), type(uint256).max);
    }

    function _open() internal returns (uint256 id) {
        vm.prank(payer);
        id = s.open(payee, 10e6, uint64(block.timestamp + 1 hours), TakarSettle.Kind.Event, "pays if Argentina won the 2022 World Cup");
    }

    function test_conditionMetPaysPayee() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 1 hours);
        vm.prank(resolver);
        s.settle(id, true, SIG, "yes");
        assertEq(usdc.balanceOf(payee), 10e6);
        assertEq(usdc.balanceOf(address(s)), 0);
    }

    function test_conditionNotMetRefundsPayer() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 1 hours);
        vm.prank(resolver);
        s.settle(id, false, SIG, "no");
        assertEq(usdc.balanceOf(payer), 100e6);
        assertEq(usdc.balanceOf(payee), 0);
    }

    function test_onlyResolverSettles() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 1 hours);
        vm.prank(payee);
        vm.expectRevert("only resolver");
        s.settle(id, true, SIG, "yes");
    }

    function test_noEarlySettle() public {
        uint256 id = _open();
        vm.prank(resolver);
        vm.expectRevert("too early");
        s.settle(id, true, SIG, "yes");
    }

    function test_noDoubleSettle() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 1 hours);
        vm.startPrank(resolver);
        s.settle(id, true, SIG, "yes");
        vm.expectRevert("not open");
        s.settle(id, false, SIG, "no");
        vm.stopPrank();
    }

    function test_settleNeedsEvidence() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 1 hours);
        vm.prank(resolver);
        vm.expectRevert("no evidence");
        s.settle(id, true, bytes32(0), "yes");
    }

    function test_reclaimOnlyAfterGrace() public {
        uint256 id = _open();
        vm.warp(block.timestamp + 1 hours + 7 days - 1);
        vm.expectRevert("grace not over");
        s.reclaim(id);
        vm.warp(block.timestamp + 1);
        s.reclaim(id);
        assertEq(usdc.balanceOf(payer), 100e6);
        vm.warp(block.timestamp + 1);
        vm.prank(resolver);
        vm.expectRevert("not open");
        s.settle(id, true, SIG, "yes");
    }

    function test_openRejectsBadInput() public {
        vm.startPrank(payer);
        vm.expectRevert("bad payee");
        s.open(payer, 1, uint64(block.timestamp + 1), TakarSettle.Kind.Event, "x");
        vm.expectRevert("zero amount");
        s.open(payee, 0, uint64(block.timestamp + 1), TakarSettle.Kind.Event, "x");
        vm.expectRevert("resolveAfter in the past");
        s.open(payee, 1, uint64(block.timestamp), TakarSettle.Kind.Event, "x");
        vm.expectRevert("terms length");
        s.open(payee, 1, uint64(block.timestamp + 1), TakarSettle.Kind.Event, "");
        vm.stopPrank();
    }
}
