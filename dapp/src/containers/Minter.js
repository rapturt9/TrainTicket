import {
  Button,
  Card,
  Form,
  Input,
  Upload,
  Row,
  Col,
  notification,
  Alert,
  Result,
  Radio,
  InputNumber,
  DatePicker,
} from "antd";
import { useNavigate } from "react-router-dom";
import { useForm } from "antd/lib/form/Form";
import { InboxOutlined } from "@ant-design/icons";
import { useContext, useState, useEffect } from "react";

import * as ipfsClient from "ipfs-http-client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";

import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  createInitializeMintInstruction,
  MINT_SIZE,
} from "@solana/spl-token";

import SolMintNftIdl from "../idl/sol_mint_nft.json";

const TOKEN_METADATA_PROGRAM_ID = new anchor.web3.PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const SOL_MINT_NFT_PROGRAM_ID = new anchor.web3.PublicKey(
  "9FKLho9AUYScrrKgJbG1mExt5nSgEfk1CNEbR8qBwKTZ"
);

const NFT_SYMBOL = "train-nft";
const projectId = "xxx";
const projectSecret = "xxx";

const auth =
  "Basic " + Buffer.from(projectId + ":" + projectSecret).toString("base64");
const ipfs = ipfsClient.create({
  host: "ipfs.infura.io",
  port: 5001,
  protocol: "https",
  headers: {
    Authorization: auth,
  },
});

const Minter = () => {
  let navigate = useNavigate();
  const { connection } = useConnection();
  const wallet = useWallet();

  const [form] = useForm();
  const [saleType, setSaleType] = useState("no_sale");

  const [uploading, setUploading] = useState(false);
  const [minting, setMinting] = useState(false);
  const [mintSuccess, setMintSuccess] = useState(false);

  function convertNumericTimeToDatetimeString(numericTime) {
    let date = new Date(numericTime);
    return date.toLocaleTimeString("en-US");
  }

  const onCreate = async (values) => {
    console.log("Connection: ", connection);
    console.log("Wallet: ", wallet);

    let { station, time, seat, destination } = values;

    time = convertNumericTimeToDatetimeString(time);

    const pngImage = await createImage({
      time,
      station,
      seat,
    });

    const buffer = Buffer.from(pngImage.split(",")[1], "base64");

    let uploadedImageUrl = await uploadImageToIpfs(buffer);
    if (uploadImageToIpfs == null) return;
    console.log("Uploaded image url: ", uploadedImageUrl);
    const name = "Train Ticket";
    let uploadedMetatdataUrl = await uploadMetadataToIpfs(
      name,
      NFT_SYMBOL,
      `This is a train ticket from ${station} to ${destination} at ${time} on ${seat} seat.`,
      uploadedImageUrl,
      station,
      time,
      seat,
      destination
    );
    if (uploadedMetatdataUrl == null) return;
    console.log("Uploaded meta data url: ", uploadedMetatdataUrl);

    setMinting(true);
    const result = await mint(name, NFT_SYMBOL, uploadedMetatdataUrl);
    setMinting(false);
    setMintSuccess(result);
  };

  const uploadImageToIpfs = async (imageFileBuffer) => {
    setUploading(true);
    console.log("Uploading image file to ipfs...");
    const uploadedImage = await ipfs.add(imageFileBuffer);

    console.log("uploadedImage: ", uploadedImage);
    setUploading(false);

    if (!uploadedImage) {
      notification["error"]({
        message: "Error",
        description: "Something went wrong when updloading the file",
      });
      return null;
    }
    console.log(`https://ipfs.infura.io/ipfs/${uploadedImage.path}`);

    return `https://ipfs.infura.io/ipfs/${uploadedImage.path}`;
  };

  const uploadMetadataToIpfs = async (
    name,
    symbol,
    description,
    uploadedImage,
    station,
    time,
    seat,
    destination
  ) => {
    const metadata = {
      name,
      symbol,
      description,
      image: uploadedImage,
      attributes: [
        {
          trait_type: "station",
          value: station,
        },
        {
          trait_type: "time",
          value: time,
        },
        {
          trait_type: "seat",
          value: seat,
        },
        {
          trait_type: "destination",
          value: destination,
        },
      ],
    };

    setUploading(true);
    const uploadedMetadata = await ipfs.add(JSON.stringify(metadata));
    setUploading(false);

    if (uploadedMetadata == null) {
      return null;
    } else {
      return `https://ipfs.infura.io/ipfs/${uploadedMetadata.path}`;
    }
  };

  const mint = async (name, symbol, metadataUrl) => {
    const provider = new anchor.AnchorProvider(connection, wallet);
    anchor.setProvider(provider);

    const program = new Program(
      SolMintNftIdl,
      SOL_MINT_NFT_PROGRAM_ID,
      provider
    );
    console.log("Program Id: ", program.programId.toBase58());
    console.log("Mint Size: ", MINT_SIZE);
    const lamports =
      await program.provider.connection.getMinimumBalanceForRentExemption(
        MINT_SIZE
      );
    console.log("Mint Account Lamports: ", lamports);

    const getMetadata = async (mint) => {
      return (
        await anchor.web3.PublicKey.findProgramAddress(
          [
            Buffer.from("metadata"),
            TOKEN_METADATA_PROGRAM_ID.toBuffer(),
            mint.toBuffer(),
          ],
          TOKEN_METADATA_PROGRAM_ID
        )
      )[0];
    };

    const mintKey = anchor.web3.Keypair.generate();

    const nftTokenAccount = await getAssociatedTokenAddress(
      mintKey.publicKey,
      provider.wallet.publicKey
    );
    console.log("NFT Account: ", nftTokenAccount.toBase58());

    const mint_tx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: mintKey.publicKey,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
        lamports,
      }),
      createInitializeMintInstruction(
        mintKey.publicKey,
        0,
        provider.wallet.publicKey,
        provider.wallet.publicKey
      ),
      createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey,
        nftTokenAccount,
        provider.wallet.publicKey,
        mintKey.publicKey
      )
    );
    let blockhashObj = await connection.getLatestBlockhash();
    console.log("blockhashObj", blockhashObj);
    mint_tx.recentBlockhash = blockhashObj.blockhash;

    try {
      const signature = await wallet.sendTransaction(mint_tx, connection, {
        signers: [mintKey],
      });
      await connection.confirmTransaction(signature, "confirmed");
    } catch {
      return false;
    }

    console.log("Mint key: ", mintKey.publicKey.toString());
    console.log("User: ", provider.wallet.publicKey.toString());

    const metadataAddress = await getMetadata(mintKey.publicKey);
    console.log("Metadata address: ", metadataAddress.toBase58());

    try {
      const tx = program.transaction.mintNft(
        mintKey.publicKey,
        name,
        symbol,
        metadataUrl,
        {
          accounts: {
            mintAuthority: provider.wallet.publicKey,
            mint: mintKey.publicKey,
            tokenAccount: nftTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            metadata: metadataAddress,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
            payer: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          },
        }
      );

      const signature = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction(signature, "confirmed");
      console.log("Mint Success!");
      return true;
    } catch {
      return false;
    }
  };

  const createImage = async (data) => {
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");

    // Set the canvas size based on the data
    canvas.width = 200;
    canvas.height = 100;

    // Draw the data onto the canvas
    ctx.font = "16px Arial";
    ctx.fillText("Time: " + data.time, 10, 20);
    ctx.fillText("Station: " + data.station, 10, 40);
    ctx.fillText("Seat: " + data.seat, 10, 60);

    // Convert the canvas to a PNG image
    const pngImage = canvas.toDataURL("image/png");
    return pngImage;
  };

  const onMintAgain = () => {
    setMintSuccess(false);
    form.resetFields();
  };

  if (mintSuccess) {
    return (
      <Result
        style={{ marginTop: 60 }}
        status="success"
        title="Successfully created your train ticket!"
        subTitle="You can view your ticket in your wallet."
        extra={[
          <Button key="buy" onClick={onMintAgain}>
            Mint Again
          </Button>,
        ]}
      />
    );
  }

  return (
    <Row style={{ margin: 60, marginLeft: 0, marginRight: 0 }}>
      {minting && (
        <Col span={22} offset={1}>
          <Alert message="Minting..." type="info" showIcon />
        </Col>
      )}
      {uploading && (
        <Col span={22} offset={1}>
          <Alert message="Uploading file..." type="info" showIcon />
        </Col>
      )}
      <Col span={22} offset={1} style={{ marginTop: 10 }}>
        <Card title="Buy Ticket">
          <Form
            form={form}
            layout="vertical"
            labelCol={8}
            wrapperCol={16}
            onFinish={onCreate}
          >
            <Row gutter={24}>
              <Col xl={12} span={24}>
                <Form.Item
                  label="Arrival Train Station"
                  name="station"
                  rules={[
                    { required: true, message: "Please input train station!" },
                  ]}
                >
                  <Input placeholder="Input train station" />
                </Form.Item>

                <Form.Item
                  label="Destination Train Station"
                  name="destination"
                  rules={[
                    { required: true, message: "Please input train station!" },
                  ]}
                >
                  <Input placeholder="Input destination train station" />
                </Form.Item>

                <Form.Item
                  label="Seat"
                  name="seat"
                  rules={[{ required: true, message: "Please input seat!" }]}
                >
                  <Input placeholder="Input train seat." />
                </Form.Item>

                <Form.Item
                  label="Date and Time"
                  name="time"
                  rules={[
                    {
                      required: true,
                      message: "Please select time!",
                    },
                  ]}
                >
                  <DatePicker
                    showTime
                    format="YYYY-MM-DD HH:mm:ss"
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item wrapperCol={{ offset: 0, span: 12 }}>
              <Button type="primary" htmlType="submit" style={{ width: 200 }}>
                Create
              </Button>
            </Form.Item>
          </Form>
          <br />
          <canvas id="canvas"></canvas>
        </Card>
      </Col>
    </Row>
  );
};

export default Minter;
